export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      demo_events: {
        Row: {
          created_at: string
          demo_id: string
          id: number
          level: string
          message: string | null
          owner_id: string
          step: string
        }
        Insert: {
          created_at?: string
          demo_id: string
          id?: number
          level?: string
          message?: string | null
          owner_id: string
          step: string
        }
        Update: {
          created_at?: string
          demo_id?: string
          id?: number
          level?: string
          message?: string | null
          owner_id?: string
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_events_demo_id_fkey"
            columns: ["demo_id"]
            isOneToOne: false
            referencedRelation: "demos"
            referencedColumns: ["id"]
          },
        ]
      }
      demos: {
        Row: {
          browserbase_session_id: string | null
          created_at: string
          creatomate_render_id: string | null
          current_step: string | null
          duration_seconds: number | null
          error_message: string | null
          feature_prompt: string
          id: string
          is_public: boolean
          mp4_url: string | null
          owner_id: string
          progress_pct: number
          project_id: string
          scene_script: Json | null
          share_slug: string | null
          status: Database["public"]["Enums"]["demo_status"]
          thumbnail_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          browserbase_session_id?: string | null
          created_at?: string
          creatomate_render_id?: string | null
          current_step?: string | null
          duration_seconds?: number | null
          error_message?: string | null
          feature_prompt: string
          id?: string
          is_public?: boolean
          mp4_url?: string | null
          owner_id: string
          progress_pct?: number
          project_id: string
          scene_script?: Json | null
          share_slug?: string | null
          status?: Database["public"]["Enums"]["demo_status"]
          thumbnail_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          browserbase_session_id?: string | null
          created_at?: string
          creatomate_render_id?: string | null
          current_step?: string | null
          duration_seconds?: number | null
          error_message?: string | null
          feature_prompt?: string
          id?: string
          is_public?: boolean
          mp4_url?: string | null
          owner_id?: string
          progress_pct?: number
          project_id?: string
          scene_script?: Json | null
          share_slug?: string | null
          status?: Database["public"]["Enums"]["demo_status"]
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          plan: Database["public"]["Enums"]["plan_tier"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          plan?: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          plan?: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
        }
        Relationships: []
      }
      project_credentials: {
        Row: {
          ciphertext: string | null
          created_at: string
          kind: Database["public"]["Enums"]["credential_kind"]
          login_url: string | null
          owner_id: string
          project_id: string
          updated_at: string
          username_hint: string | null
        }
        Insert: {
          ciphertext?: string | null
          created_at?: string
          kind?: Database["public"]["Enums"]["credential_kind"]
          login_url?: string | null
          owner_id: string
          project_id: string
          updated_at?: string
          username_hint?: string | null
        }
        Update: {
          ciphertext?: string | null
          created_at?: string
          kind?: Database["public"]["Enums"]["credential_kind"]
          login_url?: string | null
          owner_id?: string
          project_id?: string
          updated_at?: string
          username_hint?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_credentials_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          base_url: string
          created_at: string
          description: string | null
          id: string
          name: string
          owner_id: string
          site_map_md: string | null
          site_map_source: Database["public"]["Enums"]["site_map_source"] | null
          site_map_updated_at: string | null
          updated_at: string
        }
        Insert: {
          base_url: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          owner_id: string
          site_map_md?: string | null
          site_map_source?:
            | Database["public"]["Enums"]["site_map_source"]
            | null
          site_map_updated_at?: string | null
          updated_at?: string
        }
        Update: {
          base_url?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          owner_id?: string
          site_map_md?: string | null
          site_map_source?:
            | Database["public"]["Enums"]["site_map_source"]
            | null
          site_map_updated_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          demos_used_this_period: number
          period_end: string
          period_start: string
          plan: Database["public"]["Enums"]["plan_tier"]
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          demos_used_this_period?: number
          period_end?: string
          period_start?: string
          plan?: Database["public"]["Enums"]["plan_tier"]
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          demos_used_this_period?: number
          period_end?: string
          period_start?: string
          plan?: Database["public"]["Enums"]["plan_tier"]
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      project_credentials_public: {
        Row: {
          kind: Database["public"]["Enums"]["credential_kind"] | null
          login_url: string | null
          owner_id: string | null
          project_id: string | null
          updated_at: string | null
          username_hint: string | null
        }
        Insert: {
          kind?: Database["public"]["Enums"]["credential_kind"] | null
          login_url?: string | null
          owner_id?: string | null
          project_id?: string | null
          updated_at?: string | null
          username_hint?: string | null
        }
        Update: {
          kind?: Database["public"]["Enums"]["credential_kind"] | null
          login_url?: string | null
          owner_id?: string | null
          project_id?: string | null
          updated_at?: string | null
          username_hint?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_credentials_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      credential_kind: "none" | "cookie" | "password"
      demo_status:
        | "pending"
        | "scanning"
        | "planning"
        | "recording"
        | "rendering"
        | "ready"
        | "failed"
      plan_tier: "indie" | "director" | "studio"
      site_map_source: "firecrawl" | "manual"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      credential_kind: ["none", "cookie", "password"],
      demo_status: [
        "pending",
        "scanning",
        "planning",
        "recording",
        "rendering",
        "ready",
        "failed",
      ],
      plan_tier: ["indie", "director", "studio"],
      site_map_source: ["firecrawl", "manual"],
    },
  },
} as const
