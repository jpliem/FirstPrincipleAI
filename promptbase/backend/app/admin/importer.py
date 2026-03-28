import io
import json
import re
import zipfile

from sqlalchemy.ext.asyncio import AsyncSession

from app.compiler.budget import count_tokens_approx
from app.compiler.models import PromptModule, PromptPack, TaskMode


def parse_frontmatter(content: str) -> tuple[dict, str]:
    if not content.startswith("---"):
        return {}, content

    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}, content

    meta_text = parts[1].strip()
    body = parts[2].strip()

    metadata = {}
    for line in meta_text.split("\n"):
        line = line.strip()
        if ":" in line:
            key, value = line.split(":", 1)
            key = key.strip()
            value = value.strip()

            if value.startswith("[") and value.endswith("]"):
                items = value[1:-1].split(",")
                value = [item.strip().strip("'\"") for item in items]
            elif value.lower() in ("true", "false"):
                value = value.lower() == "true"
            elif value.isdigit():
                value = int(value)

            metadata[key] = value

    return metadata, body


async def import_pack_from_zip(
    db: AsyncSession,
    zip_data: bytes,
    pack_name: str,
    team_id: str | None = None,
) -> PromptPack:
    with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
        manifest = {}
        manifest_path = None
        for name in zf.namelist():
            if name.endswith("manifest.json"):
                manifest = json.loads(zf.read(name).decode("utf-8"))
                manifest_path = name
                break

        pack = PromptPack(
            name=pack_name,
            version=manifest.get("version", "1.0.0"),
            description=manifest.get("description", ""),
            team_id=team_id,
            manifest=manifest,
        )
        db.add(pack)
        await db.flush()

        base_dir = ""
        if manifest_path and "/" in manifest_path:
            base_dir = manifest_path.rsplit("/", 1)[0] + "/"

        md_files = [n for n in zf.namelist() if n.endswith(".md")]

        for md_path in sorted(md_files):
            content = zf.read(md_path).decode("utf-8")
            filename = md_path.replace(base_dir, "")

            metadata, body = parse_frontmatter(content)

            layer = _determine_layer(filename, manifest)

            sort_match = re.match(r"(\d+)", filename.split("/")[-1])
            sort_order = int(sort_match.group(1)) if sort_match else 99

            module = PromptModule(
                pack_id=pack.id,
                filename=filename,
                title=metadata.get("title", filename.replace("_", " ").replace(".md", "")),
                layer=layer,
                tags=metadata.get("use_when", metadata.get("tags", [])),
                priority=metadata.get("priority", 50 if layer == "domain" else 100),
                content=body if body else content,
                token_count=count_tokens_approx(body if body else content),
                max_tokens=metadata.get("max_chars"),
                sort_order=sort_order,
            )
            db.add(module)

        for mode_def in manifest.get("modes", []):
            mode = TaskMode(
                pack_id=pack.id,
                name=mode_def["name"],
                prompt_text=mode_def.get("prompt_text", ""),
                form_schema=mode_def.get("form_schema"),
                sort_order=mode_def.get("sort_order", 0),
            )
            db.add(mode)

        await db.commit()
        await db.refresh(pack)
        return pack


def _determine_layer(filename: str, manifest: dict) -> str:
    core_files = manifest.get("core", [])
    always_files = manifest.get("always_append", [])
    domain_sections = manifest.get("domains", {})

    clean_name = filename.split("/")[-1]

    if clean_name in core_files:
        return "core"
    if clean_name in always_files:
        return "always"
    for domain_files in domain_sections.values():
        if clean_name in domain_files:
            return "domain"

    sort_match = re.match(r"(\d+)", clean_name)
    if sort_match:
        num = int(sort_match.group(1))
        if num <= 15:
            return "core"
        if num == 16:
            return "always"
        return "domain"

    return "core"
