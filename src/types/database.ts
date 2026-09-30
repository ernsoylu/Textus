
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "annotation_tags": {
                  Row: {
                    "annotation_id": string,"tag_id": string
                  }
                  Insert: {
                    "annotation_id": string,"tag_id": string
                  }
                  Update: {
                    "annotation_id"?: string,"tag_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "annotation_tags_annotation_id_fkey"
      columns: ["annotation_id"]
isOneToOne: false
      referencedRelation: "annotations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "annotation_tags_tag_id_fkey"
      columns: ["tag_id"]
isOneToOne: false
      referencedRelation: "tags"
      referencedColumns: ["id"]
    }
                  ]
                },"annotations": {
                  Row: {
                    "anchor_data": NonNullable<Json>,"anchor_type": string,"asset_id": string,"color": string | null,"created_at": string | null,"highlighted_text": string | null,"id": string,"note": string | null,"record_id": string,"updated_at": string | null,"user_id": string
                  }
                  Insert: {
                    "anchor_data": NonNullable<Json>,"anchor_type": string,"asset_id": string,"color"?: string | null,"created_at"?: string | null,"highlighted_text"?: string | null,"id"?: string,"note"?: string | null,"record_id": string,"updated_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "anchor_data"?: NonNullable<Json>,"anchor_type"?: string,"asset_id"?: string,"color"?: string | null,"created_at"?: string | null,"highlighted_text"?: string | null,"id"?: string,"note"?: string | null,"record_id"?: string,"updated_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "annotations_asset_id_fkey"
      columns: ["asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "annotations_record_id_fkey"
      columns: ["record_id"]
isOneToOne: false
      referencedRelation: "records"
      referencedColumns: ["id"]
    }
                  ]
                },"asset_texts": {
                  Row: {
                    "asset_id": string,"content": string,"created_at": string | null,"search_vector": unknown,"user_id": string
                  }
                  Insert: {
                    "asset_id": string,"content": string,"created_at"?: string | null,"search_vector"?: never,"user_id": string
                  }
                  Update: {
                    "asset_id"?: string,"content"?: string,"created_at"?: string | null,"search_vector"?: never,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "asset_texts_asset_id_fkey"
      columns: ["asset_id"]
isOneToOne: true
      referencedRelation: "assets"
      referencedColumns: ["id"]
    }
                  ]
                },"assets": {
                  Row: {
                    "bucket": string,"checksum_sha256": string,"created_at": string | null,"file_format": string,"file_size": number,"id": string,"metadata": Json | null,"mime_type": string,"processing_error": string | null,"processing_state": string,"storage_path": string,"updated_at": string | null,"user_id": string
                  }
                  Insert: {
                    "bucket": string,"checksum_sha256": string,"created_at"?: string | null,"file_format": string,"file_size": number,"id"?: string,"metadata"?: Json | null,"mime_type": string,"processing_error"?: string | null,"processing_state"?: string,"storage_path": string,"updated_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "bucket"?: string,"checksum_sha256"?: string,"created_at"?: string | null,"file_format"?: string,"file_size"?: number,"id"?: string,"metadata"?: Json | null,"mime_type"?: string,"processing_error"?: string | null,"processing_state"?: string,"storage_path"?: string,"updated_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"collection_records": {
                  Row: {
                    "added_at": string | null,"collection_id": string,"display_order": number | null,"record_id": string
                  }
                  Insert: {
                    "added_at"?: string | null,"collection_id": string,"display_order"?: number | null,"record_id": string
                  }
                  Update: {
                    "added_at"?: string | null,"collection_id"?: string,"display_order"?: number | null,"record_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "collection_records_collection_id_fkey"
      columns: ["collection_id"]
isOneToOne: false
      referencedRelation: "collections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "collection_records_record_id_fkey"
      columns: ["record_id"]
isOneToOne: false
      referencedRelation: "records"
      referencedColumns: ["id"]
    }
                  ]
                },"collection_tags": {
                  Row: {
                    "collection_id": string,"tag_id": string
                  }
                  Insert: {
                    "collection_id": string,"tag_id": string
                  }
                  Update: {
                    "collection_id"?: string,"tag_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "collection_tags_collection_id_fkey"
      columns: ["collection_id"]
isOneToOne: false
      referencedRelation: "collections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "collection_tags_tag_id_fkey"
      columns: ["tag_id"]
isOneToOne: false
      referencedRelation: "tags"
      referencedColumns: ["id"]
    }
                  ]
                },"collections": {
                  Row: {
                    "cover_asset_id": string | null,"created_at": string | null,"description": string | null,"id": string,"name": string,"updated_at": string | null,"user_id": string
                  }
                  Insert: {
                    "cover_asset_id"?: string | null,"created_at"?: string | null,"description"?: string | null,"id"?: string,"name": string,"updated_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "cover_asset_id"?: string | null,"created_at"?: string | null,"description"?: string | null,"id"?: string,"name"?: string,"updated_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "collections_cover_asset_id_fkey"
      columns: ["cover_asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["id"]
    }
                  ]
                },"contributor_distinctions": {
                  Row: {
                    "contributor_a": string,"contributor_b": string,"created_at": string | null,"user_id": string
                  }
                  Insert: {
                    "contributor_a": string,"contributor_b": string,"created_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "contributor_a"?: string,"contributor_b"?: string,"created_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contributor_distinctions_contributor_a_fkey"
      columns: ["contributor_a"]
isOneToOne: false
      referencedRelation: "contributors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contributor_distinctions_contributor_b_fkey"
      columns: ["contributor_b"]
isOneToOne: false
      referencedRelation: "contributors"
      referencedColumns: ["id"]
    }
                  ]
                },"contributor_identifiers": {
                  Row: {
                    "contributor_id": string,"id": string,"scheme": string,"user_id": string,"value": string
                  }
                  Insert: {
                    "contributor_id": string,"id"?: string,"scheme": string,"user_id": string,"value": string
                  }
                  Update: {
                    "contributor_id"?: string,"id"?: string,"scheme"?: string,"user_id"?: string,"value"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contributor_identifiers_contributor_id_fkey"
      columns: ["contributor_id"]
isOneToOne: false
      referencedRelation: "contributors"
      referencedColumns: ["id"]
    }
                  ]
                },"contributor_names": {
                  Row: {
                    "contributor_id": string,"id": string,"match_key": string,"name": string,"name_type": string,"user_id": string
                  }
                  Insert: {
                    "contributor_id": string,"id"?: string,"match_key": string,"name": string,"name_type"?: string,"user_id": string
                  }
                  Update: {
                    "contributor_id"?: string,"id"?: string,"match_key"?: string,"name"?: string,"name_type"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contributor_names_contributor_id_fkey"
      columns: ["contributor_id"]
isOneToOne: false
      referencedRelation: "contributors"
      referencedColumns: ["id"]
    }
                  ]
                },"contributors": {
                  Row: {
                    "birth_year": number | null,"created_at": string | null,"death_year": number | null,"display_name": string,"family_name": string | null,"given_names": string | null,"id": string,"kind": string,"match_key": string,"notes": string | null,"particle": string | null,"sort_name": string,"status": string,"suffix": string | null,"updated_at": string | null,"user_id": string
                  }
                  Insert: {
                    "birth_year"?: number | null,"created_at"?: string | null,"death_year"?: number | null,"display_name": string,"family_name"?: string | null,"given_names"?: string | null,"id"?: string,"kind"?: string,"match_key": string,"notes"?: string | null,"particle"?: string | null,"sort_name": string,"status"?: string,"suffix"?: string | null,"updated_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "birth_year"?: number | null,"created_at"?: string | null,"death_year"?: number | null,"display_name"?: string,"family_name"?: string | null,"given_names"?: string | null,"id"?: string,"kind"?: string,"match_key"?: string,"notes"?: string | null,"particle"?: string | null,"sort_name"?: string,"status"?: string,"suffix"?: string | null,"updated_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"identifiers": {
                  Row: {
                    "created_at": string | null,"id": string,"is_primary": boolean | null,"normalized_value": string,"original_value": string | null,"record_id": string,"scheme": string
                  }
                  Insert: {
                    "created_at"?: string | null,"id"?: string,"is_primary"?: boolean | null,"normalized_value": string,"original_value"?: string | null,"record_id": string,"scheme": string
                  }
                  Update: {
                    "created_at"?: string | null,"id"?: string,"is_primary"?: boolean | null,"normalized_value"?: string,"original_value"?: string | null,"record_id"?: string,"scheme"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "identifiers_record_id_fkey"
      columns: ["record_id"]
isOneToOne: false
      referencedRelation: "records"
      referencedColumns: ["id"]
    }
                  ]
                },"jobs": {
                  Row: {
                    "attempts": number | null,"completed_at": string | null,"created_at": string | null,"id": string,"idempotency_key": string | null,"job_type": string,"last_error": string | null,"lease_expires_at": string | null,"max_attempts": number | null,"payload": NonNullable<Json>,"result": Json | null,"started_at": string | null,"status": string,"user_id": string | null
                  }
                  Insert: {
                    "attempts"?: number | null,"completed_at"?: string | null,"created_at"?: string | null,"id"?: string,"idempotency_key"?: string | null,"job_type": string,"last_error"?: string | null,"lease_expires_at"?: string | null,"max_attempts"?: number | null,"payload": NonNullable<Json>,"result"?: Json | null,"started_at"?: string | null,"status"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number | null,"completed_at"?: string | null,"created_at"?: string | null,"id"?: string,"idempotency_key"?: string | null,"job_type"?: string,"last_error"?: string | null,"lease_expires_at"?: string | null,"max_attempts"?: number | null,"payload"?: NonNullable<Json>,"result"?: Json | null,"started_at"?: string | null,"status"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"metadata_cache": {
                  Row: {
                    "expires_at": string | null,"fetched_at": string | null,"id": string,"identifier_scheme": string,"identifier_value": string,"provider": string,"response_data": NonNullable<Json>
                  }
                  Insert: {
                    "expires_at"?: string | null,"fetched_at"?: string | null,"id"?: string,"identifier_scheme": string,"identifier_value": string,"provider": string,"response_data": NonNullable<Json>
                  }
                  Update: {
                    "expires_at"?: string | null,"fetched_at"?: string | null,"id"?: string,"identifier_scheme"?: string,"identifier_value"?: string,"provider"?: string,"response_data"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"reading_states": {
                  Row: {
                    "asset_id": string | null,"created_at": string | null,"current_page": number | null,"current_position": Json | null,"id": string,"last_read_at": string | null,"progress_percentage": number | null,"record_id": string,"status": string,"updated_at": string | null,"user_id": string
                  }
                  Insert: {
                    "asset_id"?: string | null,"created_at"?: string | null,"current_page"?: number | null,"current_position"?: Json | null,"id"?: string,"last_read_at"?: string | null,"progress_percentage"?: number | null,"record_id": string,"status"?: string,"updated_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "asset_id"?: string | null,"created_at"?: string | null,"current_page"?: number | null,"current_position"?: Json | null,"id"?: string,"last_read_at"?: string | null,"progress_percentage"?: number | null,"record_id"?: string,"status"?: string,"updated_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reading_states_asset_id_fkey"
      columns: ["asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reading_states_record_id_fkey"
      columns: ["record_id"]
isOneToOne: false
      referencedRelation: "records"
      referencedColumns: ["id"]
    }
                  ]
                },"record_assets": {
                  Row: {
                    "asset_id": string,"created_at": string | null,"record_id": string,"role": string
                  }
                  Insert: {
                    "asset_id": string,"created_at"?: string | null,"record_id": string,"role"?: string
                  }
                  Update: {
                    "asset_id"?: string,"created_at"?: string | null,"record_id"?: string,"role"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "record_assets_asset_id_fkey"
      columns: ["asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_assets_record_id_fkey"
      columns: ["record_id"]
isOneToOne: false
      referencedRelation: "records"
      referencedColumns: ["id"]
    }
                  ]
                },"record_contributors": {
                  Row: {
                    "affiliation": string | null,"contributor_id": string,"credited_as": string | null,"position": number,"record_id": string,"resolved_by": string,"role": string
                  }
                  Insert: {
                    "affiliation"?: string | null,"contributor_id": string,"credited_as"?: string | null,"position": number,"record_id": string,"resolved_by"?: string,"role"?: string
                  }
                  Update: {
                    "affiliation"?: string | null,"contributor_id"?: string,"credited_as"?: string | null,"position"?: number,"record_id"?: string,"resolved_by"?: string,"role"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "record_contributors_contributor_id_fkey"
      columns: ["contributor_id"]
isOneToOne: false
      referencedRelation: "contributors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_contributors_record_id_fkey"
      columns: ["record_id"]
isOneToOne: false
      referencedRelation: "records"
      referencedColumns: ["id"]
    }
                  ]
                },"record_tags": {
                  Row: {
                    "record_id": string,"tag_id": string
                  }
                  Insert: {
                    "record_id": string,"tag_id": string
                  }
                  Update: {
                    "record_id"?: string,"tag_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "record_tags_record_id_fkey"
      columns: ["record_id"]
isOneToOne: false
      referencedRelation: "records"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_tags_tag_id_fkey"
      columns: ["tag_id"]
isOneToOne: false
      referencedRelation: "tags"
      referencedColumns: ["id"]
    }
                  ]
                },"records": {
                  Row: {
                    "container_record_id": string | null,"created_at": string | null,"edition": string | null,"id": string,"issue_number": string | null,"metadata": Json | null,"metadata_fetched_at": string | null,"metadata_source": string | null,"pages": string | null,"publication_date": string | null,"publication_date_precision": string | null,"publisher": string | null,"record_type": string,"search_vector": unknown,"title": string | null,"updated_at": string | null,"volume": string | null,"work_id": string
                  }
                  Insert: {
                    "container_record_id"?: string | null,"created_at"?: string | null,"edition"?: string | null,"id"?: string,"issue_number"?: string | null,"metadata"?: Json | null,"metadata_fetched_at"?: string | null,"metadata_source"?: string | null,"pages"?: string | null,"publication_date"?: string | null,"publication_date_precision"?: string | null,"publisher"?: string | null,"record_type": string,"search_vector"?: never,"title"?: string | null,"updated_at"?: string | null,"volume"?: string | null,"work_id": string
                  }
                  Update: {
                    "container_record_id"?: string | null,"created_at"?: string | null,"edition"?: string | null,"id"?: string,"issue_number"?: string | null,"metadata"?: Json | null,"metadata_fetched_at"?: string | null,"metadata_source"?: string | null,"pages"?: string | null,"publication_date"?: string | null,"publication_date_precision"?: string | null,"publisher"?: string | null,"record_type"?: string,"search_vector"?: never,"title"?: string | null,"updated_at"?: string | null,"volume"?: string | null,"work_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "records_container_record_id_fkey"
      columns: ["container_record_id"]
isOneToOne: false
      referencedRelation: "records"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "records_work_id_fkey"
      columns: ["work_id"]
isOneToOne: false
      referencedRelation: "works"
      referencedColumns: ["id"]
    }
                  ]
                },"saved_searches": {
                  Row: {
                    "created_at": string | null,"filters": NonNullable<Json>,"id": string,"name": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string | null,"filters"?: NonNullable<Json>,"id"?: string,"name": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string | null,"filters"?: NonNullable<Json>,"id"?: string,"name"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"tags": {
                  Row: {
                    "color": string | null,"created_at": string | null,"id": string,"name": string,"user_id": string
                  }
                  Insert: {
                    "color"?: string | null,"created_at"?: string | null,"id"?: string,"name": string,"user_id": string
                  }
                  Update: {
                    "color"?: string | null,"created_at"?: string | null,"id"?: string,"name"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"works": {
                  Row: {
                    "abstract": string | null,"created_at": string | null,"id": string,"language": string | null,"metadata": NonNullable<Json>,"search_vector": unknown,"subtitle": string | null,"title": string,"updated_at": string | null,"user_id": string,"user_rating": number | null,"work_type": string
                  }
                  Insert: {
                    "abstract"?: string | null,"created_at"?: string | null,"id"?: string,"language"?: string | null,"metadata"?: NonNullable<Json>,"search_vector"?: never,"subtitle"?: string | null,"title": string,"updated_at"?: string | null,"user_id": string,"user_rating"?: number | null,"work_type": string
                  }
                  Update: {
                    "abstract"?: string | null,"created_at"?: string | null,"id"?: string,"language"?: string | null,"metadata"?: NonNullable<Json>,"search_vector"?: never,"subtitle"?: string | null,"title"?: string,"updated_at"?: string | null,"user_id"?: string,"user_rating"?: number | null,"work_type"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "claim_jobs":
{ Args: { "p_lease"?: string,"p_limit"?: number }; Returns: {
              "attempts": number | null,
"completed_at": string | null,
"created_at": string | null,
"id": string,
"idempotency_key": string | null,
"job_type": string,
"last_error": string | null,
"lease_expires_at": string | null,
"max_attempts": number | null,
"payload": NonNullable<Json>,
"result": Json | null,
"started_at": string | null,
"status": string,
"user_id": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"contributor_candidates":
{ Args: { "p_match_keys": (string)[] }; Returns: {
              "affiliations": (string)[],"birth_year": number,"coauthor_keys": (string)[],"contributor_id": string,"death_year": number,"display_name": string,"given_names": string,"identifiers": Json,"kind": string,"match_key": string,"names": (string)[],"work_ids": (string)[]
            }[]
                           },
"expire_stale_jobs":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"library_languages":
{ Args: Record<PropertyKey, never>; Returns: {
              "language": string
            }[]
                           },
"library_page":
{ Args: { "p_collection"?: string,"p_format"?: string,"p_ids"?: (string)[],"p_language"?: string,"p_limit"?: number,"p_offset"?: number,"p_q"?: string,"p_sort"?: string,"p_status"?: string,"p_tag"?: string,"p_work_type"?: string }; Returns: {
              "collection_ids": (string)[],"cover_path": string,"created_at": string,"credits": Json,"formats": (string)[],"language": string,"last_read_at": string,"progress": number,"publication_date": string,"read_asset_id": string,"read_record_id": string,"record_ids": (string)[],"record_type": string,"statuses": (string)[],"tag_ids": (string)[],"title": string,"total": number,"user_rating": number,"work_id": string,"work_type": string
            }[]
                           },
"merge_contributors":
{ Args: { "p_force"?: boolean,"p_keep": string,"p_merge": string }; Returns: undefined
                           },
"possible_duplicate_contributors":
{ Args: Record<PropertyKey, never>; Returns: {
              "contributor_a": string,"contributor_b": string
            }[]
                           },
"reassign_credits":
{ Args: { "p_from": string,"p_record_ids": (string)[],"p_to": string }; Returns: undefined
                           },
"search_library":
{ Args: { "p_limit"?: number,"p_query": string }; Returns: {
              "rank": number,"record_id": string,"title": string,"work_id": string
            }[]
                           },
"set_record_contributors":
{ Args: { "p_credits": Json,"p_record_id": string }; Returns: undefined
                           },
"show_limit":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"show_trgm":
{ Args: { "": string }; Returns: (string)[]
                           },
"unaccent":
{ Args: { "": string }; Returns: string
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const

