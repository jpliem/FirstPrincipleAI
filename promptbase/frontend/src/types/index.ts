export interface User {
  id: string
  email: string
  name: string
  is_super_admin: boolean
  is_active: boolean
  created_at: string
}

export interface Team {
  id: string
  name: string
  description: string
  pack_id: string | null
  created_at: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
}

export interface Conversation {
  id: string
  title: string
  mode: string | null
  created_at: string
  updated_at: string
  message_count: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  token_count: number
  created_at: string
}

export interface Document {
  id: string
  filename: string
  file_type: string
  file_size: number
  status: 'pending' | 'processing' | 'ready' | 'failed'
  strategy: 'full_inject' | 'rag' | null
  token_count: number
  created_at: string
}

export interface PromptPack {
  id: string
  name: string
  version: string
  description: string
  team_id: string | null
  created_at: string
  module_count: number
}

export interface PromptModule {
  id: string
  filename: string
  title: string
  layer: 'core' | 'domain' | 'always'
  tags: string[]
  priority: number
  content: string
  token_count: number
  sort_order: number
}

export interface TaskMode {
  id: string
  name: string
  prompt_text: string
  form_schema: Record<string, FormField> | null
  sort_order: number
}

export interface FormField {
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'number'
  label: string
  placeholder?: string
  options?: string[]
  required?: boolean
}
