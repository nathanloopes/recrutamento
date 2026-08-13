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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      access_logs: {
        Row: {
          created_at: string | null
          device_info: string | null
          event_type: string
          id: string
          ip_address: string | null
          module_name: string | null
          success: boolean | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          device_info?: string | null
          event_type: string
          id?: string
          ip_address?: string | null
          module_name?: string | null
          success?: boolean | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          device_info?: string | null
          event_type?: string
          id?: string
          ip_address?: string | null
          module_name?: string | null
          success?: boolean | null
          user_id?: string | null
        }
        Relationships: []
      }
      activity_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          diff_json: Json | null
          id: string
          module: string | null
          record_hash: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          diff_json?: Json | null
          id?: string
          module?: string | null
          record_hash?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          diff_json?: Json | null
          id?: string
          module?: string | null
          record_hash?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      admin_users: {
        Row: {
          created_at: string | null
          created_by: string | null
          email: string | null
          id: string
          last_login_at: string | null
          name: string
          role: string
          scope_type: string | null
          scope_value: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          id?: string
          last_login_at?: string | null
          name: string
          role: string
          scope_type?: string | null
          scope_value?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          id?: string
          last_login_at?: string | null
          name?: string
          role?: string
          scope_type?: string | null
          scope_value?: string | null
          status?: string | null
        }
        Relationships: []
      }
      ai_decision_logs: {
        Row: {
          actor_id: string | null
          application_id: string | null
          cpf: string
          created_at: string
          decision_type: string
          evaluation_id: string | null
          id: string
          input: Json
          model_provider: string | null
          model_version: string | null
          module: string
          output: Json
          processing_time_ms: number | null
          record_hash: string | null
        }
        Insert: {
          actor_id?: string | null
          application_id?: string | null
          cpf: string
          created_at?: string
          decision_type?: string
          evaluation_id?: string | null
          id?: string
          input?: Json
          model_provider?: string | null
          model_version?: string | null
          module: string
          output?: Json
          processing_time_ms?: number | null
          record_hash?: string | null
        }
        Update: {
          actor_id?: string | null
          application_id?: string | null
          cpf?: string
          created_at?: string
          decision_type?: string
          evaluation_id?: string | null
          id?: string
          input?: Json
          model_provider?: string | null
          model_version?: string | null
          module?: string
          output?: Json
          processing_time_ms?: number | null
          record_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_decision_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decision_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "ai_decision_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "ai_decision_logs_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "ai_evaluations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_evaluations: {
        Row: {
          application_id: string
          created_at: string
          criteria_scores: Json
          decision: string
          explanation: string
          final_score: number
          id: string
          model_provider: string
          model_version: string | null
          processing_time_ms: number | null
          prompt_version: string | null
          risks: Json
          step_response_id: string
          strengths: Json
        }
        Insert: {
          application_id: string
          created_at?: string
          criteria_scores?: Json
          decision: string
          explanation?: string
          final_score?: number
          id?: string
          model_provider?: string
          model_version?: string | null
          processing_time_ms?: number | null
          prompt_version?: string | null
          risks?: Json
          step_response_id: string
          strengths?: Json
        }
        Update: {
          application_id?: string
          created_at?: string
          criteria_scores?: Json
          decision?: string
          explanation?: string
          final_score?: number
          id?: string
          model_provider?: string
          model_version?: string | null
          processing_time_ms?: number | null
          prompt_version?: string | null
          risks?: Json
          step_response_id?: string
          strengths?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_evaluations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_evaluations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "ai_evaluations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "ai_evaluations_step_response_id_fkey"
            columns: ["step_response_id"]
            isOneToOne: false
            referencedRelation: "step_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_global_settings: {
        Row: {
          active: boolean | null
          ai_base_prompt: string | null
          ai_decision_thresholds: Json | null
          ai_human_escalation_rules: Json | null
          ai_scoring_weights: Json | null
          ai_weight_percent: number | null
          id: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          ai_base_prompt?: string | null
          ai_decision_thresholds?: Json | null
          ai_human_escalation_rules?: Json | null
          ai_scoring_weights?: Json | null
          ai_weight_percent?: number | null
          id?: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          ai_base_prompt?: string | null
          ai_decision_thresholds?: Json | null
          ai_human_escalation_rules?: Json | null
          ai_scoring_weights?: Json | null
          ai_weight_percent?: number | null
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ai_prompt_versions: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          id: string
          is_active: boolean
          name: string
          prompt_text: string
          status: string
          target_scope: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          is_active?: boolean
          name?: string
          prompt_text: string
          status?: string
          target_scope?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          is_active?: boolean
          name?: string
          prompt_text?: string
          status?: string
          target_scope?: string
          version?: number
        }
        Relationships: []
      }
      ai_scores: {
        Row: {
          created_at: string
          dimension: string
          id: string
          justification: string | null
          model_used: string | null
          score: number
          transcript_id: string | null
          voice_interview_id: string
        }
        Insert: {
          created_at?: string
          dimension: string
          id?: string
          justification?: string | null
          model_used?: string | null
          score?: number
          transcript_id?: string | null
          voice_interview_id: string
        }
        Update: {
          created_at?: string
          dimension?: string
          id?: string
          justification?: string | null
          model_used?: string | null
          score?: number
          transcript_id?: string | null
          voice_interview_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_scores_transcript_id_fkey"
            columns: ["transcript_id"]
            isOneToOne: false
            referencedRelation: "transcripts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_scores_voice_interview_id_fkey"
            columns: ["voice_interview_id"]
            isOneToOne: false
            referencedRelation: "voice_interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      application_aso: {
        Row: {
          address: string | null
          application_id: string
          approved_at: string | null
          approved_by: string | null
          candidate_id: string
          created_at: string
          id: string
          laudo_file_url: string | null
          laudo_uploaded_at: string | null
          rejection_reason: string | null
          scheduled_at: string | null
          scheduled_by: string | null
          scheduled_date: string | null
          scheduled_time: string | null
          status: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          application_id: string
          approved_at?: string | null
          approved_by?: string | null
          candidate_id: string
          created_at?: string
          id?: string
          laudo_file_url?: string | null
          laudo_uploaded_at?: string | null
          rejection_reason?: string | null
          scheduled_at?: string | null
          scheduled_by?: string | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          status?: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          application_id?: string
          approved_at?: string | null
          approved_by?: string | null
          candidate_id?: string
          created_at?: string
          id?: string
          laudo_file_url?: string | null
          laudo_uploaded_at?: string | null
          rejection_reason?: string | null
          scheduled_at?: string | null
          scheduled_by?: string | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          status?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_aso_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_aso_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "application_aso_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "application_aso_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_aso_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_aso_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      application_cycles: {
        Row: {
          actor_user_id: string | null
          application_id: string
          closed_at: string | null
          closed_reason: string | null
          created_at: string
          cycle_number: number
          id: string
          restart_mode: string | null
          restart_phase_id: string | null
          snapshot: Json | null
          started_at: string
        }
        Insert: {
          actor_user_id?: string | null
          application_id: string
          closed_at?: string | null
          closed_reason?: string | null
          created_at?: string
          cycle_number: number
          id?: string
          restart_mode?: string | null
          restart_phase_id?: string | null
          snapshot?: Json | null
          started_at?: string
        }
        Update: {
          actor_user_id?: string | null
          application_id?: string
          closed_at?: string | null
          closed_reason?: string | null
          created_at?: string
          cycle_number?: number
          id?: string
          restart_mode?: string | null
          restart_phase_id?: string | null
          snapshot?: Json | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_cycles_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_cycles_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "application_cycles_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
        ]
      }
      application_journey_events: {
        Row: {
          actor_role: string | null
          actor_user_id: string | null
          application_id: string
          candidate_id: string | null
          created_at: string
          cycle_number: number | null
          details: Json
          event_type: string
          from_status: string | null
          id: string
          origin_campaign: string | null
          origin_channel: string | null
          origin_link_id: string | null
          phase_id: string | null
          phase_kind: string | null
          phase_label: string | null
          score: number | null
          skip_reason: string | null
          skipped: boolean
          source: string | null
          to_status: string | null
        }
        Insert: {
          actor_role?: string | null
          actor_user_id?: string | null
          application_id: string
          candidate_id?: string | null
          created_at?: string
          cycle_number?: number | null
          details?: Json
          event_type: string
          from_status?: string | null
          id?: string
          origin_campaign?: string | null
          origin_channel?: string | null
          origin_link_id?: string | null
          phase_id?: string | null
          phase_kind?: string | null
          phase_label?: string | null
          score?: number | null
          skip_reason?: string | null
          skipped?: boolean
          source?: string | null
          to_status?: string | null
        }
        Update: {
          actor_role?: string | null
          actor_user_id?: string | null
          application_id?: string
          candidate_id?: string | null
          created_at?: string
          cycle_number?: number | null
          details?: Json
          event_type?: string
          from_status?: string | null
          id?: string
          origin_campaign?: string | null
          origin_channel?: string | null
          origin_link_id?: string | null
          phase_id?: string | null
          phase_kind?: string | null
          phase_label?: string | null
          score?: number | null
          skip_reason?: string | null
          skipped?: boolean
          source?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_journey_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_journey_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "application_journey_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
        ]
      }
      applications: {
        Row: {
          candidate_id: string
          created_at: string
          current_cycle: number
          current_phase: string | null
          id: string
          is_synthetic: boolean
          last_triage_reminder_sent_at: string | null
          origin_campaign: string | null
          origin_channel:
            | Database["public"]["Enums"]["recruitment_link_channel"]
            | null
          origin_created_by: string | null
          origin_link_id: string | null
          origin_unit_id: string | null
          post_interview_modality: string | null
          post_interview_test_assigned: boolean | null
          redirected_to_discovery: boolean
          skipped_discovery: boolean
          standby_reason: string | null
          status: Database["public"]["Enums"]["application_status"]
          total_score: number | null
          triage_reminders_sent_count: number
          unit_job_id: string | null
          updated_at: string
          withdrawal_reason: string | null
          work_start_at: string | null
        }
        Insert: {
          candidate_id: string
          created_at?: string
          current_cycle?: number
          current_phase?: string | null
          id?: string
          is_synthetic?: boolean
          last_triage_reminder_sent_at?: string | null
          origin_campaign?: string | null
          origin_channel?:
            | Database["public"]["Enums"]["recruitment_link_channel"]
            | null
          origin_created_by?: string | null
          origin_link_id?: string | null
          origin_unit_id?: string | null
          post_interview_modality?: string | null
          post_interview_test_assigned?: boolean | null
          redirected_to_discovery?: boolean
          skipped_discovery?: boolean
          standby_reason?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          total_score?: number | null
          triage_reminders_sent_count?: number
          unit_job_id?: string | null
          updated_at?: string
          withdrawal_reason?: string | null
          work_start_at?: string | null
        }
        Update: {
          candidate_id?: string
          created_at?: string
          current_cycle?: number
          current_phase?: string | null
          id?: string
          is_synthetic?: boolean
          last_triage_reminder_sent_at?: string | null
          origin_campaign?: string | null
          origin_channel?:
            | Database["public"]["Enums"]["recruitment_link_channel"]
            | null
          origin_created_by?: string | null
          origin_link_id?: string | null
          origin_unit_id?: string | null
          post_interview_modality?: string | null
          post_interview_test_assigned?: boolean | null
          redirected_to_discovery?: boolean
          skipped_discovery?: boolean
          standby_reason?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          total_score?: number | null
          triage_reminders_sent_count?: number
          unit_job_id?: string | null
          updated_at?: string
          withdrawal_reason?: string | null
          work_start_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_current_phase_fkey"
            columns: ["current_phase"]
            isOneToOne: false
            referencedRelation: "pipeline_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_origin_link_id_fkey"
            columns: ["origin_link_id"]
            isOneToOne: false
            referencedRelation: "recruitment_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_unit_job_id_fkey"
            columns: ["unit_job_id"]
            isOneToOne: false
            referencedRelation: "unit_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_unit_job_id_fkey"
            columns: ["unit_job_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["unit_job_id"]
          },
        ]
      }
      archived_activity_logs: {
        Row: {
          action: string
          archived_at: string
          created_at: string
          details: Json | null
          id: string
          module: string | null
          original_table: string
          record_hash: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          archived_at?: string
          created_at?: string
          details?: Json | null
          id?: string
          module?: string | null
          original_table?: string
          record_hash?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          archived_at?: string
          created_at?: string
          details?: Json | null
          id?: string
          module?: string | null
          original_table?: string
          record_hash?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      archived_ai_decision_logs: {
        Row: {
          actor_id: string | null
          application_id: string | null
          archived_at: string
          cpf: string
          created_at: string
          decision_type: string
          evaluation_id: string | null
          id: string
          input: Json | null
          model_provider: string | null
          model_version: string | null
          module: string
          original_table: string
          output: Json | null
          processing_time_ms: number | null
          record_hash: string | null
        }
        Insert: {
          actor_id?: string | null
          application_id?: string | null
          archived_at?: string
          cpf: string
          created_at?: string
          decision_type?: string
          evaluation_id?: string | null
          id?: string
          input?: Json | null
          model_provider?: string | null
          model_version?: string | null
          module: string
          original_table?: string
          output?: Json | null
          processing_time_ms?: number | null
          record_hash?: string | null
        }
        Update: {
          actor_id?: string | null
          application_id?: string | null
          archived_at?: string
          cpf?: string
          created_at?: string
          decision_type?: string
          evaluation_id?: string | null
          id?: string
          input?: Json | null
          model_provider?: string | null
          model_version?: string | null
          module?: string
          original_table?: string
          output?: Json | null
          processing_time_ms?: number | null
          record_hash?: string | null
        }
        Relationships: []
      }
      archived_automation_logs: {
        Row: {
          action_result: string
          action_type: string
          archived_at: string
          context: Json
          error_message: string | null
          event_name: string
          executed_at: string
          execution_time_ms: number | null
          id: string
          original_table: string
          record_hash: string | null
          rule_id: string | null
        }
        Insert: {
          action_result?: string
          action_type: string
          archived_at?: string
          context?: Json
          error_message?: string | null
          event_name: string
          executed_at?: string
          execution_time_ms?: number | null
          id?: string
          original_table?: string
          record_hash?: string | null
          rule_id?: string | null
        }
        Update: {
          action_result?: string
          action_type?: string
          archived_at?: string
          context?: Json
          error_message?: string | null
          event_name?: string
          executed_at?: string
          execution_time_ms?: number | null
          id?: string
          original_table?: string
          record_hash?: string | null
          rule_id?: string | null
        }
        Relationships: []
      }
      archived_delivery_logs: {
        Row: {
          archived_at: string
          attempted_at: string | null
          channel: string
          delivered: boolean | null
          id: string
          notification_id: string | null
          original_table: string
          provider_response: Json | null
          record_hash: string | null
        }
        Insert: {
          archived_at?: string
          attempted_at?: string | null
          channel: string
          delivered?: boolean | null
          id?: string
          notification_id?: string | null
          original_table?: string
          provider_response?: Json | null
          record_hash?: string | null
        }
        Update: {
          archived_at?: string
          attempted_at?: string | null
          channel?: string
          delivered?: boolean | null
          id?: string
          notification_id?: string | null
          original_table?: string
          provider_response?: Json | null
          record_hash?: string | null
        }
        Relationships: []
      }
      attendance_logs: {
        Row: {
          attendance_status: string
          candidate_id: string
          check_in_time: string | null
          check_out_time: string | null
          created_at: string
          id: string
          interview_id: string
          justification: string | null
          recorded_by: string | null
          unit_id: string
        }
        Insert: {
          attendance_status?: string
          candidate_id: string
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          id?: string
          interview_id: string
          justification?: string | null
          recorded_by?: string | null
          unit_id: string
        }
        Update: {
          attendance_status?: string
          candidate_id?: string
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          id?: string
          interview_id?: string
          justification?: string | null
          recorded_by?: string | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_logs_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_logs_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews_for_whatsapp_notifications"
            referencedColumns: ["interview_id"]
          },
        ]
      }
      audit_trail: {
        Row: {
          action: string
          actor_id: string
          context: Json
          created_at: string
          id: string
          ip_address: string | null
          record_hash: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id: string
          context?: Json
          created_at?: string
          id?: string
          ip_address?: string | null
          record_hash?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          context?: Json
          created_at?: string
          id?: string
          ip_address?: string | null
          record_hash?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      automation_events: {
        Row: {
          event_name: string
          id: string
          payload: Json | null
          processed: boolean | null
          triggered_at: string | null
        }
        Insert: {
          event_name: string
          id?: string
          payload?: Json | null
          processed?: boolean | null
          triggered_at?: string | null
        }
        Update: {
          event_name?: string
          id?: string
          payload?: Json | null
          processed?: boolean | null
          triggered_at?: string | null
        }
        Relationships: []
      }
      automation_logs: {
        Row: {
          action_result: string
          action_type: string
          context: Json
          error_message: string | null
          event_id: string | null
          event_name: string
          executed_at: string
          execution_time_ms: number | null
          id: string
          record_hash: string | null
          rule_id: string | null
        }
        Insert: {
          action_result?: string
          action_type: string
          context?: Json
          error_message?: string | null
          event_id?: string | null
          event_name: string
          executed_at?: string
          execution_time_ms?: number | null
          id?: string
          record_hash?: string | null
          rule_id?: string | null
        }
        Update: {
          action_result?: string
          action_type?: string
          context?: Json
          error_message?: string | null
          event_id?: string | null
          event_name?: string
          executed_at?: string
          execution_time_ms?: number | null
          id?: string
          record_hash?: string | null
          rule_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "automation_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_logs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rule_versions: {
        Row: {
          action_payload: Json
          action_type: string
          changed_by: string | null
          condition_json: Json
          created_at: string
          description: string | null
          event_name: string
          id: string
          is_active: boolean
          priority: number
          rule_id: string
          version_number: number
        }
        Insert: {
          action_payload?: Json
          action_type: string
          changed_by?: string | null
          condition_json?: Json
          created_at?: string
          description?: string | null
          event_name: string
          id?: string
          is_active?: boolean
          priority?: number
          rule_id: string
          version_number?: number
        }
        Update: {
          action_payload?: Json
          action_type?: string
          changed_by?: string | null
          condition_json?: Json
          created_at?: string
          description?: string | null
          event_name?: string
          id?: string
          is_active?: boolean
          priority?: number
          rule_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "automation_rule_versions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          action_payload: Json
          action_type: string
          condition_json: Json
          created_at: string
          created_by: string | null
          description: string | null
          event_name: string
          id: string
          is_active: boolean
          priority: number
          updated_at: string
        }
        Insert: {
          action_payload?: Json
          action_type: string
          condition_json?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          event_name: string
          id?: string
          is_active?: boolean
          priority?: number
          updated_at?: string
        }
        Update: {
          action_payload?: Json
          action_type?: string
          condition_json?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          event_name?: string
          id?: string
          is_active?: boolean
          priority?: number
          updated_at?: string
        }
        Relationships: []
      }
      availability_policies: {
        Row: {
          allow_weekends: boolean | null
          created_at: string | null
          id: string
          role: string | null
          timezone: string | null
          working_days: Json | null
          working_hours: Json | null
        }
        Insert: {
          allow_weekends?: boolean | null
          created_at?: string | null
          id?: string
          role?: string | null
          timezone?: string | null
          working_days?: Json | null
          working_hours?: Json | null
        }
        Update: {
          allow_weekends?: boolean | null
          created_at?: string | null
          id?: string
          role?: string | null
          timezone?: string | null
          working_days?: Json | null
          working_hours?: Json | null
        }
        Relationships: []
      }
      availability_slots: {
        Row: {
          auto_confirm: boolean
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_active: boolean
          modality: string
          slot_type: string
          start_time: string
          unit_id: string
        }
        Insert: {
          auto_confirm?: boolean
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          is_active?: boolean
          modality?: string
          slot_type?: string
          start_time: string
          unit_id: string
        }
        Update: {
          auto_confirm?: boolean
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          is_active?: boolean
          modality?: string
          slot_type?: string
          start_time?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_slots_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_dates: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          id: string
          reason: string | null
          unit_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          id?: string
          reason?: string | null
          unit_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          reason?: string | null
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blocked_dates_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_integrations: {
        Row: {
          calendar_id: string | null
          created_at: string
          credentials_secret: string | null
          id: string
          is_active: boolean
          provider: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          calendar_id?: string | null
          created_at?: string
          credentials_secret?: string | null
          id?: string
          is_active?: boolean
          provider?: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          calendar_id?: string | null
          created_at?: string
          credentials_secret?: string | null
          id?: string
          is_active?: boolean
          provider?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_integrations_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_logs: {
        Row: {
          context: Json
          created_at: string
          event_type: string
          id: string
          rule_applied: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json
          created_at?: string
          event_type: string
          id?: string
          rule_applied?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json
          created_at?: string
          event_type?: string
          id?: string
          rule_applied?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      calendar_rules: {
        Row: {
          created_at: string | null
          id: string
          interview_buffer_minutes: number | null
          max_interviews_per_day: number | null
          min_gap_between_interviews: number | null
          no_show_policy: string | null
          reschedule_min_hours: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          interview_buffer_minutes?: number | null
          max_interviews_per_day?: number | null
          min_gap_between_interviews?: number | null
          no_show_policy?: string | null
          reschedule_min_hours?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          interview_buffer_minutes?: number | null
          max_interviews_per_day?: number | null
          min_gap_between_interviews?: number | null
          no_show_policy?: string | null
          reschedule_min_hours?: number | null
        }
        Relationships: []
      }
      candidate_documents: {
        Row: {
          candidate_id: string | null
          document_type: string
          expires_at: string | null
          file_url: string | null
          id: string
          status: string | null
          uploaded_at: string | null
          validated_by: string | null
        }
        Insert: {
          candidate_id?: string | null
          document_type: string
          expires_at?: string | null
          file_url?: string | null
          id?: string
          status?: string | null
          uploaded_at?: string | null
          validated_by?: string | null
        }
        Update: {
          candidate_id?: string | null
          document_type?: string
          expires_at?: string | null
          file_url?: string | null
          id?: string
          status?: string | null
          uploaded_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_documents_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_documents_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_locks: {
        Row: {
          candidate_id: string
          created_at: string
          expires_at: string
          id: string
          job_id: string
          locked_at: string
          locked_by: string
          release_reason: string | null
          released_at: string | null
          unit_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          expires_at?: string
          id?: string
          job_id: string
          locked_at?: string
          locked_by: string
          release_reason?: string | null
          released_at?: string | null
          unit_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          job_id?: string
          locked_at?: string
          locked_by?: string
          release_reason?: string | null
          released_at?: string | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_locks_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_locks_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_locks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_locks_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_locks_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_locks_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_profiles: {
        Row: {
          address_json: Json | null
          birth_date: string | null
          candidate_id: string
          cep: string | null
          city: string | null
          created_at: string
          email: string | null
          ethnicity: string | null
          full_name: string
          gender: string | null
          id: string
          phone: string | null
          photo_url: string | null
          professional_data: Json | null
          resume_url: string | null
          state: string | null
        }
        Insert: {
          address_json?: Json | null
          birth_date?: string | null
          candidate_id: string
          cep?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          ethnicity?: string | null
          full_name?: string
          gender?: string | null
          id?: string
          phone?: string | null
          photo_url?: string | null
          professional_data?: Json | null
          resume_url?: string | null
          state?: string | null
        }
        Update: {
          address_json?: Json | null
          birth_date?: string | null
          candidate_id?: string
          cep?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          ethnicity?: string | null
          full_name?: string
          gender?: string | null
          id?: string
          phone?: string | null
          photo_url?: string | null
          professional_data?: Json | null
          resume_url?: string | null
          state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_profiles_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: true
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_profiles_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_progress_logs: {
        Row: {
          application_id: string
          candidate_id: string
          created_at: string
          decision: string
          id: string
          metadata: Json
          phase: string
          rule_applied: string | null
          score: number | null
        }
        Insert: {
          application_id: string
          candidate_id: string
          created_at?: string
          decision: string
          id?: string
          metadata?: Json
          phase: string
          rule_applied?: string | null
          score?: number | null
        }
        Update: {
          application_id?: string
          candidate_id?: string
          created_at?: string
          decision?: string
          id?: string
          metadata?: Json
          phase?: string
          rule_applied?: string | null
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_progress_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_progress_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "candidate_progress_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "candidate_progress_logs_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_progress_logs_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_scores: {
        Row: {
          breakdown: Json | null
          candidate_id: string
          global_score: number
          id: string
          last_updated: string
        }
        Insert: {
          breakdown?: Json | null
          candidate_id: string
          global_score?: number
          id?: string
          last_updated?: string
        }
        Update: {
          breakdown?: Json | null
          candidate_id?: string
          global_score?: number
          id?: string
          last_updated?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_scores_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: true
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_scores_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_status_tracking: {
        Row: {
          candidate_id: string
          current_process_id: string | null
          current_status: string | null
          updated_at: string | null
        }
        Insert: {
          candidate_id: string
          current_process_id?: string | null
          current_status?: string | null
          updated_at?: string | null
        }
        Update: {
          candidate_id?: string
          current_process_id?: string | null
          current_status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_status_tracking_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: true
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_status_tracking_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_unit_selections: {
        Row: {
          candidate_id: string
          created_at: string
          id: string
          origin: string
          selection_type: string
          unit_id: string | null
          unit_job_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          id?: string
          origin?: string
          selection_type?: string
          unit_id?: string | null
          unit_job_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          id?: string
          origin?: string
          selection_type?: string
          unit_id?: string | null
          unit_job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_unit_selections_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_unit_selections_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_unit_selections_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_unit_selections_unit_job_id_fkey"
            columns: ["unit_job_id"]
            isOneToOne: false
            referencedRelation: "unit_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_unit_selections_unit_job_id_fkey"
            columns: ["unit_job_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["unit_job_id"]
          },
        ]
      }
      candidates: {
        Row: {
          address_json: Json | null
          avatar_url: string | null
          birth_date: string | null
          cep: string | null
          city: string | null
          cpf: string | null
          cpf_encrypted: string | null
          created_at: string
          email: string | null
          ethnicity: string | null
          full_name: string | null
          gender: string | null
          id: string
          is_active: boolean
          is_internal_test: boolean
          is_synthetic: boolean
          latitude: number | null
          longitude: number | null
          onboarding_completed: boolean
          opt_in_talent_pool: boolean
          phone: string | null
          professional_data: Json | null
          pwa_installed_at: string | null
          pwa_last_mobile_access_at: string | null
          pwa_whatsapp_invite_sent_at: string | null
          reactivation_date: string | null
          resume_url: string | null
          signature_url: string | null
          state: string | null
          status: Database["public"]["Enums"]["candidate_status"]
          status_changed_at: string | null
          status_reason: string | null
          updated_at: string
          user_status: Database["public"]["Enums"]["user_status"]
        }
        Insert: {
          address_json?: Json | null
          avatar_url?: string | null
          birth_date?: string | null
          cep?: string | null
          city?: string | null
          cpf?: string | null
          cpf_encrypted?: string | null
          created_at?: string
          email?: string | null
          ethnicity?: string | null
          full_name?: string | null
          gender?: string | null
          id: string
          is_active?: boolean
          is_internal_test?: boolean
          is_synthetic?: boolean
          latitude?: number | null
          longitude?: number | null
          onboarding_completed?: boolean
          opt_in_talent_pool?: boolean
          phone?: string | null
          professional_data?: Json | null
          pwa_installed_at?: string | null
          pwa_last_mobile_access_at?: string | null
          pwa_whatsapp_invite_sent_at?: string | null
          reactivation_date?: string | null
          resume_url?: string | null
          signature_url?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["candidate_status"]
          status_changed_at?: string | null
          status_reason?: string | null
          updated_at?: string
          user_status?: Database["public"]["Enums"]["user_status"]
        }
        Update: {
          address_json?: Json | null
          avatar_url?: string | null
          birth_date?: string | null
          cep?: string | null
          city?: string | null
          cpf?: string | null
          cpf_encrypted?: string | null
          created_at?: string
          email?: string | null
          ethnicity?: string | null
          full_name?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean
          is_internal_test?: boolean
          is_synthetic?: boolean
          latitude?: number | null
          longitude?: number | null
          onboarding_completed?: boolean
          opt_in_talent_pool?: boolean
          phone?: string | null
          professional_data?: Json | null
          pwa_installed_at?: string | null
          pwa_last_mobile_access_at?: string | null
          pwa_whatsapp_invite_sent_at?: string | null
          reactivation_date?: string | null
          resume_url?: string | null
          signature_url?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["candidate_status"]
          status_changed_at?: string | null
          status_reason?: string | null
          updated_at?: string
          user_status?: Database["public"]["Enums"]["user_status"]
        }
        Relationships: []
      }
      career_plans: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          job_id: string
          levels: Json
          unit_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          job_id: string
          levels?: Json
          unit_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          job_id?: string
          levels?: Json
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "career_plans_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "career_plans_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_availability_slots: {
        Row: {
          auto_confirm: boolean
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_active: boolean
          start_time: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          auto_confirm?: boolean
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          is_active?: boolean
          start_time: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          auto_confirm?: boolean
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          is_active?: boolean
          start_time?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_availability_slots_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_send_errors: {
        Row: {
          attempts: number
          body: string
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          resolved_at: string | null
          resolved_by: string | null
          sender_id: string
          sender_role: string
          status: string
          thread_id: string | null
        }
        Insert: {
          attempts?: number
          body: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          sender_id: string
          sender_role: string
          status?: string
          thread_id?: string | null
        }
        Update: {
          attempts?: number
          body?: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          sender_id?: string
          sender_role?: string
          status?: string
          thread_id?: string | null
        }
        Relationships: []
      }
      config_audit_logs: {
        Row: {
          category: string | null
          changed_at: string
          changed_by: string | null
          entity_type: string | null
          environment: string | null
          id: string
          key: string | null
          new_value: Json | null
          old_value: Json | null
          reason: string | null
          record_hash: string | null
          setting_id: string | null
        }
        Insert: {
          category?: string | null
          changed_at?: string
          changed_by?: string | null
          entity_type?: string | null
          environment?: string | null
          id?: string
          key?: string | null
          new_value?: Json | null
          old_value?: Json | null
          reason?: string | null
          record_hash?: string | null
          setting_id?: string | null
        }
        Update: {
          category?: string | null
          changed_at?: string
          changed_by?: string | null
          entity_type?: string | null
          environment?: string | null
          id?: string
          key?: string | null
          new_value?: Json | null
          old_value?: Json | null
          reason?: string | null
          record_hash?: string | null
          setting_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "config_audit_logs_setting_id_fkey"
            columns: ["setting_id"]
            isOneToOne: false
            referencedRelation: "global_settings"
            referencedColumns: ["id"]
          },
        ]
      }
      config_health_reports: {
        Row: {
          created_at: string
          critical_count: number
          details: Json
          duplicates: Json
          healthy_count: number
          id: string
          orphan_keys: Json
          scanned_at: string
          total_keys: number
          triggered_by: string
          unregistered_keys: Json
          warning_count: number
        }
        Insert: {
          created_at?: string
          critical_count?: number
          details?: Json
          duplicates?: Json
          healthy_count?: number
          id?: string
          orphan_keys?: Json
          scanned_at?: string
          total_keys?: number
          triggered_by?: string
          unregistered_keys?: Json
          warning_count?: number
        }
        Update: {
          created_at?: string
          critical_count?: number
          details?: Json
          duplicates?: Json
          healthy_count?: number
          id?: string
          orphan_keys?: Json
          scanned_at?: string
          total_keys?: number
          triggered_by?: string
          unregistered_keys?: Json
          warning_count?: number
        }
        Relationships: []
      }
      config_key_registry: {
        Row: {
          category: string
          consumer_paths: Json
          consumer_type: string
          created_at: string
          description: string | null
          expected_type: string
          id: string
          key: string
          status: string
          updated_at: string
        }
        Insert: {
          category: string
          consumer_paths?: Json
          consumer_type?: string
          created_at?: string
          description?: string | null
          expected_type?: string
          id?: string
          key: string
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          consumer_paths?: Json
          consumer_type?: string
          created_at?: string
          description?: string | null
          expected_type?: string
          id?: string
          key?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      config_versions: {
        Row: {
          config_snapshot: Json
          created_at: string
          created_by: string | null
          description: string | null
          environment: string
          id: string
          version_number: number
        }
        Insert: {
          config_snapshot?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          environment?: string
          id?: string
          version_number?: number
        }
        Update: {
          config_snapshot?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          environment?: string
          id?: string
          version_number?: number
        }
        Relationships: []
      }
      conversation_messages: {
        Row: {
          ai_generated: boolean
          ai_model: string | null
          ai_prompt_id: string | null
          author_kind: string
          body: string
          client_action_id: string | null
          created_at: string
          id: string
          metadata: Json
          persona: string | null
          read_at: string | null
          sender_id: string | null
          sender_mode: string | null
          sender_role: string
          thread_id: string
          tone_profile: string | null
        }
        Insert: {
          ai_generated?: boolean
          ai_model?: string | null
          ai_prompt_id?: string | null
          author_kind?: string
          body: string
          client_action_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          persona?: string | null
          read_at?: string | null
          sender_id?: string | null
          sender_mode?: string | null
          sender_role: string
          thread_id: string
          tone_profile?: string | null
        }
        Update: {
          ai_generated?: boolean
          ai_model?: string | null
          ai_prompt_id?: string | null
          author_kind?: string
          body?: string
          client_action_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          persona?: string | null
          read_at?: string | null
          sender_id?: string | null
          sender_mode?: string | null
          sender_role?: string
          thread_id?: string
          tone_profile?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "conversation_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_threads: {
        Row: {
          ai_enabled: boolean
          ai_last_acted_at: string | null
          ai_last_invoked_at: string | null
          application_id: string
          candidate_id: string
          close_reason: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          ghost_mode: boolean | null
          id: string
          last_message_at: string | null
          opened_by: string | null
          persona: string | null
          status: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          ai_enabled?: boolean
          ai_last_acted_at?: string | null
          ai_last_invoked_at?: string | null
          application_id: string
          candidate_id: string
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          ghost_mode?: boolean | null
          id?: string
          last_message_at?: string | null
          opened_by?: string | null
          persona?: string | null
          status?: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          ai_enabled?: boolean
          ai_last_acted_at?: string | null
          ai_last_invoked_at?: string | null
          application_id?: string
          candidate_id?: string
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          ghost_mode?: boolean | null
          id?: string
          last_message_at?: string | null
          opened_by?: string | null
          persona?: string | null
          status?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_threads_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_threads_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "conversation_threads_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "conversation_threads_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      cpf_history: {
        Row: {
          actor_id: string | null
          cpf: string
          created_at: string
          event: string
          id: string
          metadata: Json
          record_hash: string | null
          source_module: string
        }
        Insert: {
          actor_id?: string | null
          cpf: string
          created_at?: string
          event: string
          id?: string
          metadata?: Json
          record_hash?: string | null
          source_module: string
        }
        Update: {
          actor_id?: string | null
          cpf?: string
          created_at?: string
          event?: string
          id?: string
          metadata?: Json
          record_hash?: string | null
          source_module?: string
        }
        Relationships: []
      }
      csp_violations: {
        Row: {
          blocked_uri: string | null
          column_number: number | null
          created_at: string
          disposition: string | null
          document_uri: string | null
          effective_directive: string | null
          id: string
          line_number: number | null
          raw: Json | null
          referrer: string | null
          source_file: string | null
          user_agent: string | null
          violated_directive: string | null
        }
        Insert: {
          blocked_uri?: string | null
          column_number?: number | null
          created_at?: string
          disposition?: string | null
          document_uri?: string | null
          effective_directive?: string | null
          id?: string
          line_number?: number | null
          raw?: Json | null
          referrer?: string | null
          source_file?: string | null
          user_agent?: string | null
          violated_directive?: string | null
        }
        Update: {
          blocked_uri?: string | null
          column_number?: number | null
          created_at?: string
          disposition?: string | null
          document_uri?: string | null
          effective_directive?: string | null
          id?: string
          line_number?: number | null
          raw?: Json | null
          referrer?: string | null
          source_file?: string | null
          user_agent?: string | null
          violated_directive?: string | null
        }
        Relationships: []
      }
      dashboard_logs: {
        Row: {
          context: Json | null
          created_at: string | null
          event: string
          id: string
        }
        Insert: {
          context?: Json | null
          created_at?: string | null
          event: string
          id?: string
        }
        Update: {
          context?: Json | null
          created_at?: string | null
          event?: string
          id?: string
        }
        Relationships: []
      }
      dashboards: {
        Row: {
          active: boolean | null
          created_at: string | null
          id: string
          layout_json: Json | null
          role: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          layout_json?: Json | null
          role?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          layout_json?: Json | null
          role?: string | null
        }
        Relationships: []
      }
      default_job_attributes: {
        Row: {
          created_at: string
          created_by: string | null
          deactivated_at: string | null
          deactivated_by: string | null
          deactivation_reason: string | null
          id: string
          is_active: boolean
          is_seed: boolean
          kind: string
          label: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
          id?: string
          is_active?: boolean
          is_seed?: boolean
          kind: string
          label: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
          id?: string
          is_active?: boolean
          is_seed?: boolean
          kind?: string
          label?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      delivery_logs: {
        Row: {
          attempted_at: string | null
          channel: string
          delivered: boolean | null
          id: string
          notification_id: string | null
          provider_response: Json | null
          record_hash: string | null
        }
        Insert: {
          attempted_at?: string | null
          channel: string
          delivered?: boolean | null
          id?: string
          notification_id?: string | null
          provider_response?: Json | null
          record_hash?: string | null
        }
        Update: {
          attempted_at?: string | null
          channel?: string
          delivered?: boolean | null
          id?: string
          notification_id?: string | null
          provider_response?: Json | null
          record_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_logs_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      discovery_traits: {
        Row: {
          axis: string
          created_at: string
          created_by: string | null
          deactivated_at: string | null
          deactivated_by: string | null
          deactivation_reason: string | null
          id: string
          is_active: boolean
          is_seed: boolean
          keywords: string[]
          label: string
          legacy_id: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          axis?: string
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
          id?: string
          is_active?: boolean
          is_seed?: boolean
          keywords?: string[]
          label: string
          legacy_id?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          axis?: string
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
          id?: string
          is_active?: boolean
          is_seed?: boolean
          keywords?: string[]
          label?: string
          legacy_id?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      document_logs: {
        Row: {
          actor_id: string | null
          candidate_id: string | null
          created_at: string
          document_type: string | null
          event: string
          id: string
          metadata: Json
          record_hash: string | null
          request_id: string | null
        }
        Insert: {
          actor_id?: string | null
          candidate_id?: string | null
          created_at?: string
          document_type?: string | null
          event: string
          id?: string
          metadata?: Json
          record_hash?: string | null
          request_id?: string | null
        }
        Update: {
          actor_id?: string | null
          candidate_id?: string | null
          created_at?: string
          document_type?: string | null
          event?: string
          id?: string
          metadata?: Json
          record_hash?: string | null
          request_id?: string | null
        }
        Relationships: []
      }
      document_requests: {
        Row: {
          application_id: string
          candidate_id: string
          completed_at: string | null
          created_at: string
          custom_documents: Json
          deadline_date: string | null
          documents_list: Json
          id: string
          job_id: string
          status: string
          unit_id: string
        }
        Insert: {
          application_id: string
          candidate_id: string
          completed_at?: string | null
          created_at?: string
          custom_documents?: Json
          deadline_date?: string | null
          documents_list?: Json
          id?: string
          job_id: string
          status?: string
          unit_id: string
        }
        Update: {
          application_id?: string
          candidate_id?: string
          completed_at?: string | null
          created_at?: string
          custom_documents?: Json
          deadline_date?: string | null
          documents_list?: Json
          id?: string
          job_id?: string
          status?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_requests_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "document_requests_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "document_requests_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      document_settings: {
        Row: {
          allow_unit_extra_docs: boolean | null
          created_at: string | null
          document_deadline_days: number | null
          document_retention_policy: Json | null
          id: string
          required_documents: Json | null
        }
        Insert: {
          allow_unit_extra_docs?: boolean | null
          created_at?: string | null
          document_deadline_days?: number | null
          document_retention_policy?: Json | null
          id?: string
          required_documents?: Json | null
        }
        Update: {
          allow_unit_extra_docs?: boolean | null
          created_at?: string | null
          document_deadline_days?: number | null
          document_retention_policy?: Json | null
          id?: string
          required_documents?: Json | null
        }
        Relationships: []
      }
      document_templates: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          file_url: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
          version: number
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_url?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          version?: number
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_url?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      document_uploads: {
        Row: {
          candidate_id: string
          document_type: string
          file_url: string
          id: string
          notes: string | null
          rejection_reason: string | null
          request_id: string
          status: string
          uploaded_at: string
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          candidate_id: string
          document_type: string
          file_url: string
          id?: string
          notes?: string | null
          rejection_reason?: string | null
          request_id: string
          status?: string
          uploaded_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          candidate_id?: string
          document_type?: string
          file_url?: string
          id?: string
          notes?: string | null
          rejection_reason?: string | null
          request_id?: string
          status?: string
          uploaded_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_uploads_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_uploads_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_uploads_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "document_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_uploads_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "documents_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_uploads_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "hiring_status"
            referencedColumns: ["document_request_id"]
          },
        ]
      }
      e2e_run_logs: {
        Row: {
          created_at: string
          duration_ms: number
          error_message: string | null
          id: string
          run_at: string
          scenario: string
          stages: Json
          success: boolean
          triggered_by: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number
          error_message?: string | null
          id?: string
          run_at?: string
          scenario?: string
          stages?: Json
          success?: boolean
          triggered_by?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number
          error_message?: string | null
          id?: string
          run_at?: string
          scenario?: string
          stages?: Json
          success?: boolean
          triggered_by?: string | null
        }
        Relationships: []
      }
      email_queue: {
        Row: {
          attempts: number
          brevo_response: Json | null
          created_at: string
          html_content: string | null
          id: string
          last_error: string | null
          notification_id: string | null
          picked_at: string | null
          sent_at: string | null
          status: string
          subject: string
          text_content: string | null
          to_email: string
          to_name: string | null
        }
        Insert: {
          attempts?: number
          brevo_response?: Json | null
          created_at?: string
          html_content?: string | null
          id?: string
          last_error?: string | null
          notification_id?: string | null
          picked_at?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          text_content?: string | null
          to_email: string
          to_name?: string | null
        }
        Update: {
          attempts?: number
          brevo_response?: Json | null
          created_at?: string
          html_content?: string | null
          id?: string
          last_error?: string | null
          notification_id?: string | null
          picked_at?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          text_content?: string | null
          to_email?: string
          to_name?: string | null
        }
        Relationships: []
      }
      expo_push_tokens: {
        Row: {
          created_at: string
          id: string
          platform: string | null
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          platform?: string | null
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          platform?: string | null
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      faq_ai_logs: {
        Row: {
          admin_response: string | null
          answer: string | null
          confidence: number
          created_at: string
          id: string
          matched_article_ids: string[] | null
          question: string
          read_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          admin_response?: string | null
          answer?: string | null
          confidence?: number
          created_at?: string
          id?: string
          matched_article_ids?: string[] | null
          question: string
          read_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          admin_response?: string | null
          answer?: string | null
          confidence?: number
          created_at?: string
          id?: string
          matched_article_ids?: string[] | null
          question?: string
          read_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      faq_article_versions: {
        Row: {
          answer: string
          article_id: string
          changed_by: string | null
          created_at: string
          id: string
          question: string
          tags: string[] | null
          version: number
        }
        Insert: {
          answer: string
          article_id: string
          changed_by?: string | null
          created_at?: string
          id?: string
          question: string
          tags?: string[] | null
          version: number
        }
        Update: {
          answer?: string
          article_id?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          question?: string
          tags?: string[] | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "faq_article_versions_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "faq_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      faq_articles: {
        Row: {
          answer: string
          created_at: string
          created_by: string | null
          id: string
          question: string
          source_ticket_id: string | null
          status: string
          tags: string[] | null
          updated_at: string
          version: number
        }
        Insert: {
          answer: string
          created_at?: string
          created_by?: string | null
          id?: string
          question: string
          source_ticket_id?: string | null
          status?: string
          tags?: string[] | null
          updated_at?: string
          version?: number
        }
        Update: {
          answer?: string
          created_at?: string
          created_by?: string | null
          id?: string
          question?: string
          source_ticket_id?: string | null
          status?: string
          tags?: string[] | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "faq_articles_source_ticket_id_fkey"
            columns: ["source_ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      faq_feedback: {
        Row: {
          comment: string | null
          created_at: string
          faq_article_id: string
          helpful: boolean
          id: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          faq_article_id: string
          helpful: boolean
          id?: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          faq_article_id?: string
          helpful?: boolean
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "faq_feedback_faq_article_id_fkey"
            columns: ["faq_article_id"]
            isOneToOne: false
            referencedRelation: "faq_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          created_at: string
          description: string | null
          enabled: boolean
          environment: string
          id: string
          module_name: string
          rollout_config: Json
          rollout_strategy: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          description?: string | null
          enabled?: boolean
          environment?: string
          id?: string
          module_name: string
          rollout_config?: Json
          rollout_strategy?: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          description?: string | null
          enabled?: boolean
          environment?: string
          id?: string
          module_name?: string
          rollout_config?: Json
          rollout_strategy?: string
          updated_at?: string
        }
        Relationships: []
      }
      geo_index: {
        Row: {
          cep: string | null
          id: string
          location: unknown
          unit_id: string | null
        }
        Insert: {
          cep?: string | null
          id?: string
          location?: unknown
          unit_id?: string | null
        }
        Update: {
          cep?: string | null
          id?: string
          location?: unknown
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "geo_index_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      global_settings: {
        Row: {
          _audit_reason: string | null
          category: string
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          _audit_reason?: string | null
          category: string
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          _audit_reason?: string | null
          category?: string
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "global_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "global_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_audit_logs: {
        Row: {
          created_at: string
          details: Json
          device_id: string | null
          event_type: string
          id: number
          ip_hash: string | null
          risk_score: number
          session_id: string | null
          user_agent_hash: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          device_id?: string | null
          event_type: string
          id?: never
          ip_hash?: string | null
          risk_score?: number
          session_id?: string | null
          user_agent_hash?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          device_id?: string | null
          event_type?: string
          id?: never
          ip_hash?: string | null
          risk_score?: number
          session_id?: string | null
          user_agent_hash?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "identity_audit_logs_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "identity_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_audit_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "identity_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_delegation_grants: {
        Row: {
          cancelled_at: string | null
          code_challenge: string
          code_challenge_method: string
          code_hash: string
          consumed_at: string | null
          consumed_by_device_id: string | null
          expires_at: string
          id: string
          metadata: Json
          requested_scopes: string[]
          source_device_id: string
          source_session_id: string
          target_client_type: Database["public"]["Enums"]["identity_client_type"]
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          code_challenge: string
          code_challenge_method?: string
          code_hash: string
          consumed_at?: string | null
          consumed_by_device_id?: string | null
          expires_at: string
          id?: string
          metadata?: Json
          requested_scopes?: string[]
          source_device_id: string
          source_session_id: string
          target_client_type: Database["public"]["Enums"]["identity_client_type"]
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          code_challenge?: string
          code_challenge_method?: string
          code_hash?: string
          consumed_at?: string | null
          consumed_by_device_id?: string | null
          expires_at?: string
          id?: string
          metadata?: Json
          requested_scopes?: string[]
          source_device_id?: string
          source_session_id?: string
          target_client_type?: Database["public"]["Enums"]["identity_client_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_delegation_grants_consumed_by_device_id_fkey"
            columns: ["consumed_by_device_id"]
            isOneToOne: false
            referencedRelation: "identity_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_delegation_grants_source_device_id_fkey"
            columns: ["source_device_id"]
            isOneToOne: false
            referencedRelation: "identity_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_delegation_grants_source_session_id_fkey"
            columns: ["source_session_id"]
            isOneToOne: false
            referencedRelation: "identity_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_devices: {
        Row: {
          app_version: string | null
          browser_name: string | null
          client_type: Database["public"]["Enums"]["identity_client_type"]
          device_label: string | null
          device_seed_hash: string
          fingerprint_hash: string
          fingerprint_version: number
          first_seen_at: string
          id: string
          last_seen_at: string
          metadata: Json
          os_name: string | null
          platform: string | null
          public_key_jwk: Json | null
          revoke_reason: string | null
          revoked_at: string | null
          trust_status: Database["public"]["Enums"]["identity_device_trust_status"]
          trusted_at: string | null
          user_agent_hash: string | null
          user_id: string
        }
        Insert: {
          app_version?: string | null
          browser_name?: string | null
          client_type: Database["public"]["Enums"]["identity_client_type"]
          device_label?: string | null
          device_seed_hash: string
          fingerprint_hash: string
          fingerprint_version?: number
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          metadata?: Json
          os_name?: string | null
          platform?: string | null
          public_key_jwk?: Json | null
          revoke_reason?: string | null
          revoked_at?: string | null
          trust_status?: Database["public"]["Enums"]["identity_device_trust_status"]
          trusted_at?: string | null
          user_agent_hash?: string | null
          user_id: string
        }
        Update: {
          app_version?: string | null
          browser_name?: string | null
          client_type?: Database["public"]["Enums"]["identity_client_type"]
          device_label?: string | null
          device_seed_hash?: string
          fingerprint_hash?: string
          fingerprint_version?: number
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          metadata?: Json
          os_name?: string | null
          platform?: string | null
          public_key_jwk?: Json | null
          revoke_reason?: string | null
          revoked_at?: string | null
          trust_status?: Database["public"]["Enums"]["identity_device_trust_status"]
          trusted_at?: string | null
          user_agent_hash?: string | null
          user_id?: string
        }
        Relationships: []
      }
      identity_refresh_tokens: {
        Row: {
          consumed_at: string | null
          expires_at: string
          id: string
          ip_hash: string | null
          issued_at: string
          metadata: Json
          refresh_family_id: string
          replaced_by: string | null
          revoked_at: string | null
          session_id: string
          token_hash: string
          user_agent_hash: string | null
        }
        Insert: {
          consumed_at?: string | null
          expires_at: string
          id?: string
          ip_hash?: string | null
          issued_at?: string
          metadata?: Json
          refresh_family_id: string
          replaced_by?: string | null
          revoked_at?: string | null
          session_id: string
          token_hash: string
          user_agent_hash?: string | null
        }
        Update: {
          consumed_at?: string | null
          expires_at?: string
          id?: string
          ip_hash?: string | null
          issued_at?: string
          metadata?: Json
          refresh_family_id?: string
          replaced_by?: string | null
          revoked_at?: string | null
          session_id?: string
          token_hash?: string
          user_agent_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "identity_refresh_tokens_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "identity_refresh_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_refresh_tokens_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "identity_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_sessions: {
        Row: {
          absolute_expires_at: string
          assurance_level: number
          audience: string
          auth_source: string
          client_type: Database["public"]["Enums"]["identity_client_type"]
          delegated_from_session_id: string | null
          device_id: string
          id: string
          idle_expires_at: string
          issued_at: string
          last_geo_country: string | null
          last_ip_hash: string | null
          last_seen_at: string
          metadata: Json
          revoke_reason: string | null
          revoked_at: string | null
          status: Database["public"]["Enums"]["identity_session_status"]
          supabase_session_id: string | null
          user_agent_hash: string | null
          user_id: string
        }
        Insert: {
          absolute_expires_at: string
          assurance_level?: number
          audience: string
          auth_source?: string
          client_type: Database["public"]["Enums"]["identity_client_type"]
          delegated_from_session_id?: string | null
          device_id: string
          id?: string
          idle_expires_at: string
          issued_at?: string
          last_geo_country?: string | null
          last_ip_hash?: string | null
          last_seen_at?: string
          metadata?: Json
          revoke_reason?: string | null
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["identity_session_status"]
          supabase_session_id?: string | null
          user_agent_hash?: string | null
          user_id: string
        }
        Update: {
          absolute_expires_at?: string
          assurance_level?: number
          audience?: string
          auth_source?: string
          client_type?: Database["public"]["Enums"]["identity_client_type"]
          delegated_from_session_id?: string | null
          device_id?: string
          id?: string
          idle_expires_at?: string
          issued_at?: string
          last_geo_country?: string | null
          last_ip_hash?: string | null
          last_seen_at?: string
          metadata?: Json
          revoke_reason?: string | null
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["identity_session_status"]
          supabase_session_id?: string | null
          user_agent_hash?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_sessions_delegated_from_session_id_fkey"
            columns: ["delegated_from_session_id"]
            isOneToOne: false
            referencedRelation: "identity_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "identity_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_logs: {
        Row: {
          actor_id: string | null
          context: Json
          created_at: string
          event: string
          id: string
          integration_id: string | null
          success: boolean
        }
        Insert: {
          actor_id?: string | null
          context?: Json
          created_at?: string
          event: string
          id?: string
          integration_id?: string | null
          success?: boolean
        }
        Update: {
          actor_id?: string | null
          context?: Json
          created_at?: string
          event?: string
          id?: string
          integration_id?: string | null
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "integration_logs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integration_settings"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_settings: {
        Row: {
          config_json: Json
          created_at: string
          id: string
          integration_type: string
          is_active: boolean
          last_health_check: string | null
          provider: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config_json?: Json
          created_at?: string
          id?: string
          integration_type: string
          is_active?: boolean
          last_health_check?: string | null
          provider: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config_json?: Json
          created_at?: string
          id?: string
          integration_type?: string
          is_active?: boolean
          last_health_check?: string | null
          provider?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_users: {
        Row: {
          cpf: string
          cpf_encrypted: string | null
          cpf_hash: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
          role: string | null
          status: string | null
          unit_code: string | null
        }
        Insert: {
          cpf: string
          cpf_encrypted?: string | null
          cpf_hash?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          role?: string | null
          status?: string | null
          unit_code?: string | null
        }
        Update: {
          cpf?: string
          cpf_encrypted?: string | null
          cpf_hash?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          role?: string | null
          status?: string | null
          unit_code?: string | null
        }
        Relationships: []
      }
      interview_events_log: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          interview_id: string
          metadata: Json | null
          new_status: string | null
          previous_status: string | null
          reason: string | null
          record_hash: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          interview_id: string
          metadata?: Json | null
          new_status?: string | null
          previous_status?: string | null
          reason?: string | null
          record_hash?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          interview_id?: string
          metadata?: Json | null
          new_status?: string | null
          previous_status?: string | null
          reason?: string | null
          record_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_events_log_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_events_log_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews_for_whatsapp_notifications"
            referencedColumns: ["interview_id"]
          },
        ]
      }
      interview_feedback: {
        Row: {
          checklist_json: Json
          created_at: string
          decision: string
          evaluator_id: string
          guide_id: string | null
          id: string
          interview_id: string
          notes: string | null
          record_hash: string | null
        }
        Insert: {
          checklist_json?: Json
          created_at?: string
          decision: string
          evaluator_id: string
          guide_id?: string | null
          id?: string
          interview_id: string
          notes?: string | null
          record_hash?: string | null
        }
        Update: {
          checklist_json?: Json
          created_at?: string
          decision?: string
          evaluator_id?: string
          guide_id?: string | null
          id?: string
          interview_id?: string
          notes?: string | null
          record_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_feedback_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "interview_guides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_feedback_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: true
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_feedback_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: true
            referencedRelation: "interviews_for_whatsapp_notifications"
            referencedColumns: ["interview_id"]
          },
        ]
      }
      interview_guides: {
        Row: {
          created_at: string
          created_by: string | null
          guide_json: Json
          id: string
          is_active: boolean
          job_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          guide_json?: Json
          id?: string
          is_active?: boolean
          job_id: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          guide_json?: Json
          id?: string
          is_active?: boolean
          job_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "interview_guides_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      interviews: {
        Row: {
          ai_result: Json | null
          application_id: string
          approved_at: string | null
          approved_by: string | null
          candidate_id: string
          confirmed_at: string | null
          created_at: string
          id: string
          interviewer_id: string | null
          meeting_link: string | null
          meeting_provider: string
          modality: string
          no_show_resolution: string | null
          no_show_response_deadline: string | null
          notes: string | null
          purpose: string
          reminder_sent: Json | null
          reschedule_count: number
          reschedule_reason: string | null
          room_started_at: string | null
          room_started_by: string | null
          scheduled_date: string
          scheduled_time: string
          slot_id: string | null
          status: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          ai_result?: Json | null
          application_id: string
          approved_at?: string | null
          approved_by?: string | null
          candidate_id: string
          confirmed_at?: string | null
          created_at?: string
          id?: string
          interviewer_id?: string | null
          meeting_link?: string | null
          meeting_provider?: string
          modality: string
          no_show_resolution?: string | null
          no_show_response_deadline?: string | null
          notes?: string | null
          purpose?: string
          reminder_sent?: Json | null
          reschedule_count?: number
          reschedule_reason?: string | null
          room_started_at?: string | null
          room_started_by?: string | null
          scheduled_date: string
          scheduled_time: string
          slot_id?: string | null
          status?: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          ai_result?: Json | null
          application_id?: string
          approved_at?: string | null
          approved_by?: string | null
          candidate_id?: string
          confirmed_at?: string | null
          created_at?: string
          id?: string
          interviewer_id?: string | null
          meeting_link?: string | null
          meeting_provider?: string
          modality?: string
          no_show_resolution?: string | null
          no_show_response_deadline?: string | null
          notes?: string | null
          purpose?: string
          reminder_sent?: Json | null
          reschedule_count?: number
          reschedule_reason?: string | null
          room_started_at?: string | null
          room_started_by?: string | null
          scheduled_date?: string
          scheduled_time?: string
          slot_id?: string | null
          status?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "interviews_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "availability_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      job_benefits: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          unit_job_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          unit_job_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          unit_job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_benefits_unit_job_id_fkey"
            columns: ["unit_job_id"]
            isOneToOne: false
            referencedRelation: "unit_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_benefits_unit_job_id_fkey"
            columns: ["unit_job_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["unit_job_id"]
          },
        ]
      }
      job_logs: {
        Row: {
          context: Json | null
          created_at: string | null
          event: string
          id: string
          job_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string | null
          event: string
          id?: string
          job_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string | null
          event?: string
          id?: string
          job_id?: string | null
        }
        Relationships: []
      }
      job_pipelines: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          job_id: string
          name: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          job_id: string
          name: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          job_id?: string
          name?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_pipelines_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_requests: {
        Row: {
          benefits: Json | null
          created_at: string
          created_unit_job_id: string | null
          description: string | null
          id: string
          job_id: string | null
          openings: number | null
          reference_cep: string | null
          reference_lat: number | null
          reference_lng: number | null
          reference_radius_km: number | null
          requested_by: string
          requirements: string[]
          responsibilities: string[]
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          salary: number | null
          status: string
          title: string
          unit_id: string
          updated_at: string
          work_model: string | null
        }
        Insert: {
          benefits?: Json | null
          created_at?: string
          created_unit_job_id?: string | null
          description?: string | null
          id?: string
          job_id?: string | null
          openings?: number | null
          reference_cep?: string | null
          reference_lat?: number | null
          reference_lng?: number | null
          reference_radius_km?: number | null
          requested_by: string
          requirements?: string[]
          responsibilities?: string[]
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          salary?: number | null
          status?: string
          title: string
          unit_id: string
          updated_at?: string
          work_model?: string | null
        }
        Update: {
          benefits?: Json | null
          created_at?: string
          created_unit_job_id?: string | null
          description?: string | null
          id?: string
          job_id?: string | null
          openings?: number | null
          reference_cep?: string | null
          reference_lat?: number | null
          reference_lng?: number | null
          reference_radius_km?: number | null
          requested_by?: string
          requirements?: string[]
          responsibilities?: string[]
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          salary?: number | null
          status?: string
          title?: string
          unit_id?: string
          updated_at?: string
          work_model?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_requests_created_unit_job_id_fkey"
            columns: ["created_unit_job_id"]
            isOneToOne: false
            referencedRelation: "unit_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_requests_created_unit_job_id_fkey"
            columns: ["created_unit_job_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["unit_job_id"]
          },
          {
            foreignKeyName: "job_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_requests_requested_by_profile_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_requests_requested_by_profile_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_requests_reviewed_by_profile_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_requests_reviewed_by_profile_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_requests_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      job_versions: {
        Row: {
          change_reason: string | null
          changed_by: string | null
          created_at: string
          id: string
          job_id: string | null
          snapshot: Json
          version_number: number
        }
        Insert: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          id?: string
          job_id?: string | null
          snapshot?: Json
          version_number?: number
        }
        Update: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          id?: string
          job_id?: string | null
          snapshot?: Json
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_versions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          allows_career_plan: boolean
          benefits: Json
          category: string | null
          code: string | null
          created_at: string
          created_by: string | null
          department_id: string | null
          description: string | null
          discovery_highlights: Json
          discovery_invite: string | null
          discovery_traits: Json
          id: string
          is_active: boolean
          min_score: number | null
          requirements: string[]
          requires_ai_interview: boolean
          requires_documents: boolean | null
          requires_human_interview: boolean
          responsibilities: string[]
          sede_only: boolean
          title: string
          updated_at: string
        }
        Insert: {
          allows_career_plan?: boolean
          benefits?: Json
          category?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          discovery_highlights?: Json
          discovery_invite?: string | null
          discovery_traits?: Json
          id?: string
          is_active?: boolean
          min_score?: number | null
          requirements?: string[]
          requires_ai_interview?: boolean
          requires_documents?: boolean | null
          requires_human_interview?: boolean
          responsibilities?: string[]
          sede_only?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          allows_career_plan?: boolean
          benefits?: Json
          category?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          discovery_highlights?: Json
          discovery_invite?: string | null
          discovery_traits?: Json
          id?: string
          is_active?: boolean
          min_score?: number | null
          requirements?: string[]
          requires_ai_interview?: boolean
          requires_documents?: boolean | null
          requires_human_interview?: boolean
          responsibilities?: string[]
          sede_only?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      metrics_snapshots: {
        Row: {
          avg_hiring_time_days: number
          conversion_rate: number
          created_at: string
          funnel_data: Json
          id: string
          period: string
          rejection_rate: number
          total_candidates: number
          total_jobs_open: number
          unit_id: string | null
        }
        Insert: {
          avg_hiring_time_days?: number
          conversion_rate?: number
          created_at?: string
          funnel_data?: Json
          id?: string
          period?: string
          rejection_rate?: number
          total_candidates?: number
          total_jobs_open?: number
          unit_id?: string | null
        }
        Update: {
          avg_hiring_time_days?: number
          conversion_rate?: number
          created_at?: string
          funnel_data?: Json
          id?: string
          period?: string
          rejection_rate?: number
          total_candidates?: number
          total_jobs_open?: number
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "metrics_snapshots_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_logs: {
        Row: {
          application_id: string
          candidate_id: string
          completed_at: string | null
          created_at: string
          id: string
          invite_expires_at: string | null
          job_id: string | null
          notes: string | null
          status: string
          target_role: string
          triggered_by: string | null
          unit_id: string | null
        }
        Insert: {
          application_id: string
          candidate_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          invite_expires_at?: string | null
          job_id?: string | null
          notes?: string | null
          status?: string
          target_role?: string
          triggered_by?: string | null
          unit_id?: string | null
        }
        Update: {
          application_id?: string
          candidate_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          invite_expires_at?: string | null
          job_id?: string | null
          notes?: string | null
          status?: string
          target_role?: string
          triggered_by?: string | null
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "migration_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "migration_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "migration_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "migration_logs_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "migration_logs_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "migration_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "migration_logs_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      module_activation_logs: {
        Row: {
          changed_at: string
          changed_by: string | null
          environment: string
          id: string
          metadata: Json
          module_name: string
          new_status: boolean
          previous_status: boolean | null
          record_hash: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          environment?: string
          id?: string
          metadata?: Json
          module_name: string
          new_status: boolean
          previous_status?: boolean | null
          record_hash?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          environment?: string
          id?: string
          metadata?: Json
          module_name?: string
          new_status?: boolean
          previous_status?: boolean | null
          record_hash?: string | null
        }
        Relationships: []
      }
      module_status: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          active: boolean | null
          environment: string | null
          id: string
          module_name: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          active?: boolean | null
          environment?: string | null
          id?: string
          module_name: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          active?: boolean | null
          environment?: string | null
          id?: string
          module_name?: string
        }
        Relationships: []
      }
      notification_limits: {
        Row: {
          cooldown_minutes: number | null
          global_enabled: boolean | null
          id: string
          max_per_day: number | null
          max_per_hour: number | null
        }
        Insert: {
          cooldown_minutes?: number | null
          global_enabled?: boolean | null
          id?: string
          max_per_day?: number | null
          max_per_hour?: number | null
        }
        Update: {
          cooldown_minutes?: number | null
          global_enabled?: boolean | null
          id?: string
          max_per_day?: number | null
          max_per_hour?: number | null
        }
        Relationships: []
      }
      notification_logs: {
        Row: {
          channel: string | null
          created_at: string | null
          error_message: string | null
          event_type: string
          id: string
          status: string | null
          user_id: string | null
        }
        Insert: {
          channel?: string | null
          created_at?: string | null
          error_message?: string | null
          event_type: string
          id?: string
          status?: string | null
          user_id?: string | null
        }
        Update: {
          channel?: string | null
          created_at?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          status?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          event_overrides: Json
          id: string
          preferred_channel: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_overrides?: Json
          id?: string
          preferred_channel?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_overrides?: Json
          id?: string
          preferred_channel?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_settings: {
        Row: {
          created_at: string | null
          enabled: boolean | null
          event_type: string
          fallback_channel: string | null
          id: string
          primary_channel: string | null
          priority: number | null
        }
        Insert: {
          created_at?: string | null
          enabled?: boolean | null
          event_type: string
          fallback_channel?: string | null
          id?: string
          primary_channel?: string | null
          priority?: number | null
        }
        Update: {
          created_at?: string | null
          enabled?: boolean | null
          event_type?: string
          fallback_channel?: string | null
          id?: string
          primary_channel?: string | null
          priority?: number | null
        }
        Relationships: []
      }
      notification_template_versions: {
        Row: {
          body: string
          changed_by: string | null
          channel: string
          created_at: string
          event_type: string
          fallback_channel: string | null
          id: string
          priority: string | null
          status: string | null
          template_id: string
          title: string | null
          variables: Json | null
          version: number
        }
        Insert: {
          body: string
          changed_by?: string | null
          channel: string
          created_at?: string
          event_type: string
          fallback_channel?: string | null
          id?: string
          priority?: string | null
          status?: string | null
          template_id: string
          title?: string | null
          variables?: Json | null
          version?: number
        }
        Update: {
          body?: string
          changed_by?: string | null
          channel?: string
          created_at?: string
          event_type?: string
          fallback_channel?: string | null
          id?: string
          priority?: string | null
          status?: string | null
          template_id?: string
          title?: string | null
          variables?: Json | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "notification_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "notification_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          body: string
          channel: string
          created_at: string | null
          created_by: string | null
          event_type: string
          fallback_channel: string | null
          id: string
          is_active: boolean | null
          meta_template_language: string | null
          meta_template_name: string | null
          meta_variable_mapping: Json | null
          priority: string | null
          status: string
          title: string | null
          variables: Json | null
          version: number | null
        }
        Insert: {
          body: string
          channel: string
          created_at?: string | null
          created_by?: string | null
          event_type: string
          fallback_channel?: string | null
          id?: string
          is_active?: boolean | null
          meta_template_language?: string | null
          meta_template_name?: string | null
          meta_variable_mapping?: Json | null
          priority?: string | null
          status?: string
          title?: string | null
          variables?: Json | null
          version?: number | null
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string | null
          created_by?: string | null
          event_type?: string
          fallback_channel?: string | null
          id?: string
          is_active?: boolean | null
          meta_template_language?: string | null
          meta_template_name?: string | null
          meta_variable_mapping?: Json | null
          priority?: string | null
          status?: string
          title?: string | null
          variables?: Json | null
          version?: number | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          action_type: string
          action_url: string | null
          body: string | null
          channel: string
          created_at: string | null
          dedup_key: string | null
          event_type: string
          id: string
          payload: Json | null
          read_at: string | null
          recipient_id: string
          retry_count: number | null
          status: string | null
          template_id: string | null
          title: string | null
        }
        Insert: {
          action_type?: string
          action_url?: string | null
          body?: string | null
          channel: string
          created_at?: string | null
          dedup_key?: string | null
          event_type: string
          id?: string
          payload?: Json | null
          read_at?: string | null
          recipient_id: string
          retry_count?: number | null
          status?: string | null
          template_id?: string | null
          title?: string | null
        }
        Update: {
          action_type?: string
          action_url?: string | null
          body?: string | null
          channel?: string
          created_at?: string | null
          dedup_key?: string | null
          event_type?: string
          id?: string
          payload?: Json | null
          read_at?: string | null
          recipient_id?: string
          retry_count?: number | null
          status?: string | null
          template_id?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "notification_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_status: {
        Row: {
          candidate_id: string
          completed_at: string | null
          created_at: string
          current_step: string
          id: string
          is_completed: boolean
          migration_id: string
          started_at: string | null
          steps_completed: Json
        }
        Insert: {
          candidate_id: string
          completed_at?: string | null
          created_at?: string
          current_step?: string
          id?: string
          is_completed?: boolean
          migration_id: string
          started_at?: string | null
          steps_completed?: Json
        }
        Update: {
          candidate_id?: string
          completed_at?: string | null
          created_at?: string
          current_step?: string
          id?: string
          is_completed?: boolean
          migration_id?: string
          started_at?: string | null
          steps_completed?: Json
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_status_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_status_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_status_migration_id_fkey"
            columns: ["migration_id"]
            isOneToOne: false
            referencedRelation: "migration_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_pool: {
        Row: {
          active: boolean | null
          candidate_id: string | null
          entered_at: string | null
          id: string
          last_job_id: string | null
          origin_unit: string | null
          standby_reason: string | null
        }
        Insert: {
          active?: boolean | null
          candidate_id?: string | null
          entered_at?: string | null
          id?: string
          last_job_id?: string | null
          origin_unit?: string | null
          standby_reason?: string | null
        }
        Update: {
          active?: boolean | null
          candidate_id?: string | null
          entered_at?: string | null
          id?: string
          last_job_id?: string | null
          origin_unit?: string | null
          standby_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_pool_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_pool_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          can_approve: boolean
          can_configure: boolean | null
          can_create: boolean | null
          can_delete: boolean | null
          can_edit: boolean | null
          can_export: boolean | null
          can_view: boolean | null
          created_at: string | null
          id: string
          module_name: string
          override_reason: string | null
          user_id: string | null
        }
        Insert: {
          can_approve?: boolean
          can_configure?: boolean | null
          can_create?: boolean | null
          can_delete?: boolean | null
          can_edit?: boolean | null
          can_export?: boolean | null
          can_view?: boolean | null
          created_at?: string | null
          id?: string
          module_name: string
          override_reason?: string | null
          user_id?: string | null
        }
        Update: {
          can_approve?: boolean
          can_configure?: boolean | null
          can_create?: boolean | null
          can_delete?: boolean | null
          can_edit?: boolean | null
          can_export?: boolean | null
          can_view?: boolean | null
          created_at?: string | null
          id?: string
          module_name?: string
          override_reason?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      pipeline_ai_logs: {
        Row: {
          ai_action: string | null
          ai_result: Json | null
          candidate_id: string | null
          created_at: string | null
          id: string
          phase_id: string | null
          pipeline_id: string | null
          step_id: string | null
        }
        Insert: {
          ai_action?: string | null
          ai_result?: Json | null
          candidate_id?: string | null
          created_at?: string | null
          id?: string
          phase_id?: string | null
          pipeline_id?: string | null
          step_id?: string | null
        }
        Update: {
          ai_action?: string | null
          ai_result?: Json | null
          candidate_id?: string | null
          created_at?: string | null
          id?: string
          phase_id?: string | null
          pipeline_id?: string | null
          step_id?: string | null
        }
        Relationships: []
      }
      pipeline_phases: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          min_score: number | null
          name: string
          order_index: number
          phase_kind: string
          phase_type: string
          pipeline_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          min_score?: number | null
          name: string
          order_index?: number
          phase_kind?: string
          phase_type?: string
          pipeline_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          min_score?: number | null
          name?: string
          order_index?: number
          phase_kind?: string
          phase_type?: string
          pipeline_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_phases_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "job_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_steps: {
        Row: {
          conditions: Json | null
          content: Json | null
          created_at: string
          id: string
          is_automated: boolean | null
          is_optional: boolean | null
          order_index: number
          phase_id: string
          title: string
          type: Database["public"]["Enums"]["step_type"]
          weight: number
        }
        Insert: {
          conditions?: Json | null
          content?: Json | null
          created_at?: string
          id?: string
          is_automated?: boolean | null
          is_optional?: boolean | null
          order_index?: number
          phase_id: string
          title: string
          type?: Database["public"]["Enums"]["step_type"]
          weight?: number
        }
        Update: {
          conditions?: Json | null
          content?: Json | null
          created_at?: string
          id?: string
          is_automated?: boolean | null
          is_optional?: boolean | null
          order_index?: number
          phase_id?: string
          title?: string
          type?: Database["public"]["Enums"]["step_type"]
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_steps_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "pipeline_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      progression_rules: {
        Row: {
          active: boolean | null
          allow_reapply_after_days: number | null
          id: string
          max_retry_attempts: number | null
          min_score_human_interview: number | null
          min_score_ia_interview: number | null
          min_score_phase_1: number | null
        }
        Insert: {
          active?: boolean | null
          allow_reapply_after_days?: number | null
          id?: string
          max_retry_attempts?: number | null
          min_score_human_interview?: number | null
          min_score_ia_interview?: number | null
          min_score_phase_1?: number | null
        }
        Update: {
          active?: boolean | null
          allow_reapply_after_days?: number | null
          id?: string
          max_retry_attempts?: number | null
          min_score_human_interview?: number | null
          min_score_ia_interview?: number | null
          min_score_phase_1?: number | null
        }
        Relationships: []
      }
      push_dispatch_log: {
        Row: {
          dispatched_at: string
          notification_id: string
        }
        Insert: {
          dispatched_at?: string
          notification_id: string
        }
        Update: {
          dispatched_at?: string
          notification_id?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          is_active: boolean
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          is_active?: boolean
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          is_active?: boolean
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      pwa_events: {
        Row: {
          created_at: string
          event: string
          id: string
          meta: Json
          platform: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          meta?: Json
          platform?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          meta?: Json
          platform?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          hits: number
          identifier: string
          updated_at: string
          window_start: string
        }
        Insert: {
          bucket: string
          hits?: number
          identifier: string
          updated_at?: string
          window_start?: string
        }
        Update: {
          bucket?: string
          hits?: number
          identifier?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      recruitment_links: {
        Row: {
          applications_count: number
          campaign: string | null
          channel: Database["public"]["Enums"]["recruitment_link_channel"]
          clicks_count: number
          created_at: string
          created_by: string
          deactivated_at: string | null
          deactivation_reason: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          job_id: string
          job_slug: string | null
          label: string | null
          short_code: string | null
          token: string
          unit_id: string
          unit_job_id: string | null
          unit_slug: string | null
          updated_at: string
        }
        Insert: {
          applications_count?: number
          campaign?: string | null
          channel: Database["public"]["Enums"]["recruitment_link_channel"]
          clicks_count?: number
          created_at?: string
          created_by: string
          deactivated_at?: string | null
          deactivation_reason?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          job_id: string
          job_slug?: string | null
          label?: string | null
          short_code?: string | null
          token: string
          unit_id: string
          unit_job_id?: string | null
          unit_slug?: string | null
          updated_at?: string
        }
        Update: {
          applications_count?: number
          campaign?: string | null
          channel?: Database["public"]["Enums"]["recruitment_link_channel"]
          clicks_count?: number
          created_at?: string
          created_by?: string
          deactivated_at?: string | null
          deactivation_reason?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          job_id?: string
          job_slug?: string | null
          label?: string | null
          short_code?: string | null
          token?: string
          unit_id?: string
          unit_job_id?: string | null
          unit_slug?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruitment_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_links_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_links_unit_job_id_fkey"
            columns: ["unit_job_id"]
            isOneToOne: false
            referencedRelation: "unit_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruitment_links_unit_job_id_fkey"
            columns: ["unit_job_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["unit_job_id"]
          },
        ]
      }
      regions: {
        Row: {
          cep_ranges: Json
          created_at: string
          id: string
          is_active: boolean
          name: string
          radius_km: number
        }
        Insert: {
          cep_ranges?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          radius_km?: number
        }
        Update: {
          cep_ranges?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          radius_km?: number
        }
        Relationships: []
      }
      resume_versions: {
        Row: {
          candidate_id: string
          file_name: string
          file_url: string
          id: string
          uploaded_at: string
          version: number
        }
        Insert: {
          candidate_id: string
          file_name: string
          file_url: string
          id?: string
          uploaded_at?: string
          version?: number
        }
        Update: {
          candidate_id?: string
          file_name?: string
          file_url?: string
          id?: string
          uploaded_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "resume_versions_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_versions_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rollback_events: {
        Row: {
          created_at: string
          id: string
          justification: string
          record_hash: string | null
          restored_version_id: string
          triggered_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          justification: string
          record_hash?: string | null
          restored_version_id: string
          triggered_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          justification?: string
          record_hash?: string | null
          restored_version_id?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rollback_events_restored_version_id_fkey"
            columns: ["restored_version_id"]
            isOneToOne: false
            referencedRelation: "config_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_groups: {
        Row: {
          created_at: string
          id: string
          name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      score_events: {
        Row: {
          candidate_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          new_score: number
          previous_score: number
          process_stage: string | null
          reason: string
          record_hash: string | null
          related_job_id: string | null
          score_delta: number
        }
        Insert: {
          candidate_id: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          new_score: number
          previous_score?: number
          process_stage?: string | null
          reason: string
          record_hash?: string | null
          related_job_id?: string | null
          score_delta: number
        }
        Update: {
          candidate_id?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          new_score?: number
          previous_score?: number
          process_stage?: string | null
          reason?: string
          record_hash?: string | null
          related_job_id?: string | null
          score_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "score_events_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_events_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_events_related_job_id_fkey"
            columns: ["related_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_rules: {
        Row: {
          active: boolean | null
          applies_to: string | null
          created_at: string | null
          id: string
          min_score: number | null
          phase: string
        }
        Insert: {
          active?: boolean | null
          applies_to?: string | null
          created_at?: string | null
          id?: string
          min_score?: number | null
          phase: string
        }
        Update: {
          active?: boolean | null
          applies_to?: string | null
          created_at?: string | null
          id?: string
          min_score?: number | null
          phase?: string
        }
        Relationships: []
      }
      secure_keys: {
        Row: {
          active: boolean | null
          created_at: string | null
          encrypted_value: string | null
          id: string
          integration_id: string | null
          key_name: string
          version: number | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          encrypted_value?: string | null
          id?: string
          integration_id?: string | null
          key_name: string
          version?: number | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          encrypted_value?: string | null
          id?: string
          integration_id?: string | null
          key_name?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "secure_keys_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integration_settings"
            referencedColumns: ["id"]
          },
        ]
      }
      step_responses: {
        Row: {
          application_id: string
          created_at: string
          evaluated_at: string | null
          id: string
          response: Json | null
          retry_count: number
          score: number | null
          step_id: string
        }
        Insert: {
          application_id: string
          created_at?: string
          evaluated_at?: string | null
          id?: string
          response?: Json | null
          retry_count?: number
          score?: number | null
          step_id: string
        }
        Update: {
          application_id?: string
          created_at?: string
          evaluated_at?: string | null
          id?: string
          response?: Json | null
          retry_count?: number
          score?: number | null
          step_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "step_responses_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "step_responses_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "step_responses_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "step_responses_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "pipeline_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          admin_response: string | null
          ai_answer: string | null
          ai_confidence: number | null
          candidate_id: string
          context: Json | null
          created_at: string
          id: string
          matched_article_ids: string[] | null
          question: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          admin_response?: string | null
          ai_answer?: string | null
          ai_confidence?: number | null
          candidate_id: string
          context?: Json | null
          created_at?: string
          id?: string
          matched_article_ids?: string[] | null
          question: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          admin_response?: string | null
          ai_answer?: string | null
          ai_confidence?: number | null
          candidate_id?: string
          context?: Json | null
          created_at?: string
          id?: string
          matched_article_ids?: string[] | null
          question?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      talent_invites: {
        Row: {
          candidate_id: string
          channel: string
          id: string
          invited_at: string
          message: string | null
          responded_at: string | null
          restart_mode: string | null
          status: Database["public"]["Enums"]["talent_invite_status"]
          unit_job_id: string
        }
        Insert: {
          candidate_id: string
          channel?: string
          id?: string
          invited_at?: string
          message?: string | null
          responded_at?: string | null
          restart_mode?: string | null
          status?: Database["public"]["Enums"]["talent_invite_status"]
          unit_job_id: string
        }
        Update: {
          candidate_id?: string
          channel?: string
          id?: string
          invited_at?: string
          message?: string | null
          responded_at?: string | null
          restart_mode?: string | null
          status?: Database["public"]["Enums"]["talent_invite_status"]
          unit_job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "talent_invites_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "talent_invites_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "talent_invites_unit_job_id_fkey"
            columns: ["unit_job_id"]
            isOneToOne: false
            referencedRelation: "unit_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "talent_invites_unit_job_id_fkey"
            columns: ["unit_job_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["unit_job_id"]
          },
        ]
      }
      talent_pool_entries: {
        Row: {
          approved_job_id: string | null
          candidate_id: string
          created_at: string
          entry_origin: string
          global_score: number
          id: string
          is_synthetic: boolean
          last_interaction: string
          last_job_id: string | null
          origin_unit_id: string | null
          preferred_regions: Json
          preferred_roles: Json
          score_breakdown: Json
          standby_reason: string | null
          status: Database["public"]["Enums"]["talent_pool_status"]
          test_completed_at: string | null
          test_details: Json | null
          test_score: number | null
          updated_at: string
        }
        Insert: {
          approved_job_id?: string | null
          candidate_id: string
          created_at?: string
          entry_origin?: string
          global_score?: number
          id?: string
          is_synthetic?: boolean
          last_interaction?: string
          last_job_id?: string | null
          origin_unit_id?: string | null
          preferred_regions?: Json
          preferred_roles?: Json
          score_breakdown?: Json
          standby_reason?: string | null
          status?: Database["public"]["Enums"]["talent_pool_status"]
          test_completed_at?: string | null
          test_details?: Json | null
          test_score?: number | null
          updated_at?: string
        }
        Update: {
          approved_job_id?: string | null
          candidate_id?: string
          created_at?: string
          entry_origin?: string
          global_score?: number
          id?: string
          is_synthetic?: boolean
          last_interaction?: string
          last_job_id?: string | null
          origin_unit_id?: string | null
          preferred_regions?: Json
          preferred_roles?: Json
          score_breakdown?: Json
          standby_reason?: string | null
          status?: Database["public"]["Enums"]["talent_pool_status"]
          test_completed_at?: string | null
          test_details?: Json | null
          test_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "talent_pool_entries_approved_job_id_fkey"
            columns: ["approved_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "talent_pool_entries_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: true
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "talent_pool_entries_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "talent_pool_entries_last_job_id_fkey"
            columns: ["last_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "talent_pool_entries_origin_unit_id_fkey"
            columns: ["origin_unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      talent_pool_logs: {
        Row: {
          candidate_id: string
          context: Json
          created_at: string
          event: string
          id: string
        }
        Insert: {
          candidate_id: string
          context?: Json
          created_at?: string
          event: string
          id?: string
        }
        Update: {
          candidate_id?: string
          context?: Json
          created_at?: string
          event?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "talent_pool_logs_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "talent_pool_logs_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      test_assignments: {
        Row: {
          application_id: string
          assigned_by: string | null
          booking_id: string | null
          candidate_id: string
          completed_at: string | null
          created_at: string
          deadline: string | null
          evaluated_at: string | null
          evaluated_by: string | null
          evaluator_notes: string | null
          id: string
          is_mandatory: boolean
          last_reminder_sent_at: string | null
          modality_chosen: string | null
          post_interview: boolean
          released_at: string | null
          reminders_sent_count: number
          response: Json | null
          score: number | null
          started_at: string | null
          status: string
          test_template_id: string
        }
        Insert: {
          application_id: string
          assigned_by?: string | null
          booking_id?: string | null
          candidate_id: string
          completed_at?: string | null
          created_at?: string
          deadline?: string | null
          evaluated_at?: string | null
          evaluated_by?: string | null
          evaluator_notes?: string | null
          id?: string
          is_mandatory?: boolean
          last_reminder_sent_at?: string | null
          modality_chosen?: string | null
          post_interview?: boolean
          released_at?: string | null
          reminders_sent_count?: number
          response?: Json | null
          score?: number | null
          started_at?: string | null
          status?: string
          test_template_id: string
        }
        Update: {
          application_id?: string
          assigned_by?: string | null
          booking_id?: string | null
          candidate_id?: string
          completed_at?: string | null
          created_at?: string
          deadline?: string | null
          evaluated_at?: string | null
          evaluated_by?: string | null
          evaluator_notes?: string | null
          id?: string
          is_mandatory?: boolean
          last_reminder_sent_at?: string | null
          modality_chosen?: string | null
          post_interview?: boolean
          released_at?: string | null
          reminders_sent_count?: number
          response?: Json | null
          score?: number | null
          started_at?: string | null
          status?: string
          test_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_assignments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_assignments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "test_assignments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "test_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "test_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_assignments_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_assignments_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_assignments_test_template_id_fkey"
            columns: ["test_template_id"]
            isOneToOne: false
            referencedRelation: "test_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      test_bookings: {
        Row: {
          application_id: string
          candidate_id: string
          created_at: string
          end_time: string | null
          id: string
          modality: string
          notes: string | null
          scheduled_date: string
          scheduled_time: string
          status: string
          test_assignment_id: string | null
          unit_id: string
          updated_at: string
        }
        Insert: {
          application_id: string
          candidate_id: string
          created_at?: string
          end_time?: string | null
          id?: string
          modality?: string
          notes?: string | null
          scheduled_date: string
          scheduled_time: string
          status?: string
          test_assignment_id?: string | null
          unit_id: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          candidate_id?: string
          created_at?: string
          end_time?: string | null
          id?: string
          modality?: string
          notes?: string | null
          scheduled_date?: string
          scheduled_time?: string
          status?: string
          test_assignment_id?: string | null
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_bookings_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_bookings_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "test_bookings_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "test_bookings_test_assignment_id_fkey"
            columns: ["test_assignment_id"]
            isOneToOne: false
            referencedRelation: "test_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_bookings_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      test_feedback: {
        Row: {
          application_id: string
          booking_id: string | null
          checklist_json: Json
          created_at: string
          decision: string
          evaluator_id: string
          finalized_at: string
          id: string
          notes: string | null
          recruiter_average: number | null
          risk_score: number | null
          standby_reason: string | null
          test_guide_id: string | null
          test_guide_version: number | null
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          application_id: string
          booking_id?: string | null
          checklist_json?: Json
          created_at?: string
          decision: string
          evaluator_id: string
          finalized_at?: string
          id?: string
          notes?: string | null
          recruiter_average?: number | null
          risk_score?: number | null
          standby_reason?: string | null
          test_guide_id?: string | null
          test_guide_version?: number | null
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          application_id?: string
          booking_id?: string | null
          checklist_json?: Json
          created_at?: string
          decision?: string
          evaluator_id?: string
          finalized_at?: string
          id?: string
          notes?: string | null
          recruiter_average?: number | null
          risk_score?: number | null
          standby_reason?: string | null
          test_guide_id?: string | null
          test_guide_version?: number | null
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_feedback_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_feedback_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "test_feedback_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "test_feedback_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "test_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_feedback_test_guide_id_fkey"
            columns: ["test_guide_id"]
            isOneToOne: false
            referencedRelation: "test_guides"
            referencedColumns: ["id"]
          },
        ]
      }
      test_guides: {
        Row: {
          created_at: string
          created_by: string | null
          guide_json: Json
          id: string
          is_active: boolean
          job_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          guide_json?: Json
          id?: string
          is_active?: boolean
          job_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          guide_json?: Json
          id?: string
          is_active?: boolean
          job_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "test_guides_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      test_packs: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          level: string
          name: string
          rules: Json
          template_ids: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          level?: string
          name: string
          rules?: Json
          template_ids?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          level?: string
          name?: string
          rules?: Json
          template_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_packs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_packs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      test_templates: {
        Row: {
          category: string
          content: Json
          created_at: string
          created_by: string | null
          description: string
          estimated_time_minutes: number | null
          execution_mode: string
          id: string
          is_active: boolean
          job_ids: string[]
          level: string | null
          subcategory: string
          tags: string[] | null
          time_limit_minutes: number | null
          title: string
          type: string
        }
        Insert: {
          category?: string
          content?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          estimated_time_minutes?: number | null
          execution_mode?: string
          id?: string
          is_active?: boolean
          job_ids?: string[]
          level?: string | null
          subcategory?: string
          tags?: string[] | null
          time_limit_minutes?: number | null
          title: string
          type?: string
        }
        Update: {
          category?: string
          content?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          estimated_time_minutes?: number | null
          execution_mode?: string
          id?: string
          is_active?: boolean
          job_ids?: string[]
          level?: string | null
          subcategory?: string
          tags?: string[] | null
          time_limit_minutes?: number | null
          title?: string
          type?: string
        }
        Relationships: []
      }
      transcripts: {
        Row: {
          audio_storage_path: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          question_index: number
          question_text: string
          transcription: string | null
          voice_interview_id: string
        }
        Insert: {
          audio_storage_path?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          question_index: number
          question_text: string
          transcription?: string | null
          voice_interview_id: string
        }
        Update: {
          audio_storage_path?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          question_index?: number
          question_text?: string
          transcription?: string | null
          voice_interview_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcripts_voice_interview_id_fkey"
            columns: ["voice_interview_id"]
            isOneToOne: false
            referencedRelation: "voice_interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      triage_logs: {
        Row: {
          candidate_id: string | null
          context: Json | null
          created_at: string | null
          event: string
          id: string
        }
        Insert: {
          candidate_id?: string | null
          context?: Json | null
          created_at?: string | null
          event: string
          id?: string
        }
        Update: {
          candidate_id?: string | null
          context?: Json | null
          created_at?: string | null
          event?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "triage_logs_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_logs_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      triage_pipelines: {
        Row: {
          active: boolean | null
          created_at: string | null
          id: string
          phases_json: Json | null
          role_id: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          phases_json?: Json | null
          role_id?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          phases_json?: Json | null
          role_id?: string | null
        }
        Relationships: []
      }
      triage_results: {
        Row: {
          candidate_id: string | null
          created_at: string | null
          decision: string | null
          explanation: string | null
          id: string
          pipeline_id: string | null
          score: number | null
          stage_id: string | null
        }
        Insert: {
          candidate_id?: string | null
          created_at?: string | null
          decision?: string | null
          explanation?: string | null
          id?: string
          pipeline_id?: string | null
          score?: number | null
          stage_id?: string | null
        }
        Update: {
          candidate_id?: string | null
          created_at?: string | null
          decision?: string | null
          explanation?: string | null
          id?: string
          pipeline_id?: string | null
          score?: number | null
          stage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "triage_results_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_results_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_results_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "triage_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_results_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "triage_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      triage_stages: {
        Row: {
          config_json: Json | null
          created_at: string | null
          id: string
          pipeline_id: string | null
          type: string
          weight: number | null
        }
        Insert: {
          config_json?: Json | null
          created_at?: string | null
          id?: string
          pipeline_id?: string | null
          type: string
          weight?: number | null
        }
        Update: {
          config_json?: Json | null
          created_at?: string | null
          id?: string
          pipeline_id?: string | null
          type?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "triage_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "triage_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_config_logs: {
        Row: {
          change_type: string
          changed_by: string | null
          created_at: string
          id: string
          new_config: Json
          previous_config: Json | null
          unit_id: string
        }
        Insert: {
          change_type?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          new_config?: Json
          previous_config?: Json | null
          unit_id: string
        }
        Update: {
          change_type?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          new_config?: Json
          previous_config?: Json | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_config_logs_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_defaults: {
        Row: {
          career_plan_enabled_default: boolean | null
          created_at: string | null
          default_allowed_roles: Json | null
          default_language: string | null
          default_radius_km: number | null
          default_required_documents: Json | null
          default_tone: string | null
          id: string
        }
        Insert: {
          career_plan_enabled_default?: boolean | null
          created_at?: string | null
          default_allowed_roles?: Json | null
          default_language?: string | null
          default_radius_km?: number | null
          default_required_documents?: Json | null
          default_tone?: string | null
          id?: string
        }
        Update: {
          career_plan_enabled_default?: boolean | null
          created_at?: string | null
          default_allowed_roles?: Json | null
          default_language?: string | null
          default_radius_km?: number | null
          default_required_documents?: Json | null
          default_tone?: string | null
          id?: string
        }
        Relationships: []
      }
      unit_implementation: {
        Row: {
          checklist: Json
          created_at: string
          engagement_level: string | null
          id: string
          milestones: Json
          next_action: string | null
          next_action_date: string | null
          observacoes: string | null
          responsavel_id: string | null
          status: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          checklist?: Json
          created_at?: string
          engagement_level?: string | null
          id?: string
          milestones?: Json
          next_action?: string | null
          next_action_date?: string | null
          observacoes?: string | null
          responsavel_id?: string | null
          status?: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          checklist?: Json
          created_at?: string
          engagement_level?: string | null
          id?: string
          milestones?: Json
          next_action?: string | null
          next_action_date?: string | null
          observacoes?: string | null
          responsavel_id?: string | null
          status?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_implementation_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: true
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_job_salary_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          new_salary: number | null
          old_salary: number | null
          unit_job_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_salary?: number | null
          old_salary?: number | null
          unit_job_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_salary?: number | null
          old_salary?: number | null
          unit_job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_job_salary_history_unit_job_id_fkey"
            columns: ["unit_job_id"]
            isOneToOne: false
            referencedRelation: "unit_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_job_salary_history_unit_job_id_fkey"
            columns: ["unit_job_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["unit_job_id"]
          },
        ]
      }
      unit_jobs: {
        Row: {
          address_cep: string | null
          address_city: string | null
          address_complement: string | null
          address_neighborhood: string | null
          address_number: string | null
          address_state: string | null
          address_street: string | null
          benefits_override: Json | null
          candidate_filters: Json | null
          closes_at: string | null
          contract_type: string
          created_at: string
          id: string
          job_id: string
          openings: number | null
          opens_at: string | null
          requirements_override: Json | null
          responsibilities_override: Json | null
          salary: number | null
          salary_max: number | null
          salary_min: number | null
          status: Database["public"]["Enums"]["unit_job_status"]
          unit_id: string
          work_hours_weekly: number | null
          work_model: string | null
        }
        Insert: {
          address_cep?: string | null
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          benefits_override?: Json | null
          candidate_filters?: Json | null
          closes_at?: string | null
          contract_type?: string
          created_at?: string
          id?: string
          job_id: string
          openings?: number | null
          opens_at?: string | null
          requirements_override?: Json | null
          responsibilities_override?: Json | null
          salary?: number | null
          salary_max?: number | null
          salary_min?: number | null
          status?: Database["public"]["Enums"]["unit_job_status"]
          unit_id: string
          work_hours_weekly?: number | null
          work_model?: string | null
        }
        Update: {
          address_cep?: string | null
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          benefits_override?: Json | null
          candidate_filters?: Json | null
          closes_at?: string | null
          contract_type?: string
          created_at?: string
          id?: string
          job_id?: string
          openings?: number | null
          opens_at?: string | null
          requirements_override?: Json | null
          responsibilities_override?: Json | null
          salary?: number | null
          salary_max?: number | null
          salary_min?: number | null
          status?: Database["public"]["Enums"]["unit_job_status"]
          unit_id?: string
          work_hours_weekly?: number | null
          work_model?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unit_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_jobs_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_policies: {
        Row: {
          allowed_roles: Json
          career_plan_enabled: boolean
          created_at: string
          id: string
          language: string
          override_allowed: boolean
          radius_km: number
          required_documents: Json
          tone: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          allowed_roles?: Json
          career_plan_enabled?: boolean
          created_at?: string
          id?: string
          language?: string
          override_allowed?: boolean
          radius_km?: number
          required_documents?: Json
          tone?: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          allowed_roles?: Json
          career_plan_enabled?: boolean
          created_at?: string
          id?: string
          language?: string
          override_allowed?: boolean
          radius_km?: number
          required_documents?: Json
          tone?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_policies_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: true
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_test_config: {
        Row: {
          created_at: string
          enabled: boolean
          modality: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          modality?: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          modality?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_test_config_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: true
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_test_terms_acceptance: {
        Row: {
          accepted_at: string
          created_at: string
          id: string
          modality: string | null
          unit_id: string
          user_cpf: string | null
          user_id: string
          user_name: string | null
        }
        Insert: {
          accepted_at?: string
          created_at?: string
          id?: string
          modality?: string | null
          unit_id: string
          user_cpf?: string | null
          user_id: string
          user_name?: string | null
        }
        Update: {
          accepted_at?: string
          created_at?: string
          id?: string
          modality?: string | null
          unit_id?: string
          user_cpf?: string | null
          user_id?: string
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unit_test_terms_acceptance_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_timeline_notes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string
          note_date: string
          unit_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note: string
          note_date?: string
          unit_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string
          note_date?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_timeline_notes_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          cep: string | null
          city: string | null
          code: string | null
          company_id: string | null
          created_at: string
          id: string
          is_active: boolean
          is_franqueadora: boolean
          is_internal_test: boolean
          latitude: number | null
          longitude: number | null
          name: string
          origem_unidade: string
          schedule_group_id: string | null
          state: string | null
          updated_at: string
        }
        Insert: {
          cep?: string | null
          city?: string | null
          code?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_franqueadora?: boolean
          is_internal_test?: boolean
          latitude?: number | null
          longitude?: number | null
          name: string
          origem_unidade?: string
          schedule_group_id?: string | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          cep?: string | null
          city?: string | null
          code?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_franqueadora?: boolean
          is_internal_test?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string
          origem_unidade?: string
          schedule_group_id?: string | null
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_schedule_group_id_fkey"
            columns: ["schedule_group_id"]
            isOneToOne: false
            referencedRelation: "schedule_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          scope_access: string
          unit_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          scope_access?: string
          unit_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          scope_access?: string
          unit_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_ai_logs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          input_data: Json | null
          model_used: string | null
          output_data: Json | null
          processing_time_ms: number | null
          task_type: string
          voice_interview_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          input_data?: Json | null
          model_used?: string | null
          output_data?: Json | null
          processing_time_ms?: number | null
          task_type: string
          voice_interview_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          input_data?: Json | null
          model_used?: string | null
          output_data?: Json | null
          processing_time_ms?: number | null
          task_type?: string
          voice_interview_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_ai_logs_voice_interview_id_fkey"
            columns: ["voice_interview_id"]
            isOneToOne: false
            referencedRelation: "voice_interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_interview_scores: {
        Row: {
          created_at: string
          dimension: string
          id: string
          justification: string | null
          model_used: string | null
          score: number
          transcript_id: string | null
          voice_interview_id: string
        }
        Insert: {
          created_at?: string
          dimension: string
          id?: string
          justification?: string | null
          model_used?: string | null
          score?: number
          transcript_id?: string | null
          voice_interview_id: string
        }
        Update: {
          created_at?: string
          dimension?: string
          id?: string
          justification?: string | null
          model_used?: string | null
          score?: number
          transcript_id?: string | null
          voice_interview_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_interview_scores_transcript_id_fkey"
            columns: ["transcript_id"]
            isOneToOne: false
            referencedRelation: "voice_interview_transcripts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_interview_scores_voice_interview_id_fkey"
            columns: ["voice_interview_id"]
            isOneToOne: false
            referencedRelation: "voice_interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_interview_transcripts: {
        Row: {
          audio_storage_path: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          question_index: number
          question_text: string
          transcription: string | null
          voice_interview_id: string
        }
        Insert: {
          audio_storage_path?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          question_index: number
          question_text: string
          transcription?: string | null
          voice_interview_id: string
        }
        Update: {
          audio_storage_path?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          question_index?: number
          question_text?: string
          transcription?: string | null
          voice_interview_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_interview_transcripts_voice_interview_id_fkey"
            columns: ["voice_interview_id"]
            isOneToOne: false
            referencedRelation: "voice_interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_interviews: {
        Row: {
          application_id: string | null
          candidate_id: string
          config_snapshot: Json | null
          consent_given_at: string | null
          created_at: string
          ended_at: string | null
          final_decision: string | null
          final_score: number | null
          id: string
          job_title: string | null
          script_version: string | null
          started_at: string
          status: string
        }
        Insert: {
          application_id?: string | null
          candidate_id: string
          config_snapshot?: Json | null
          consent_given_at?: string | null
          created_at?: string
          ended_at?: string | null
          final_decision?: string | null
          final_score?: number | null
          id?: string
          job_title?: string | null
          script_version?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          application_id?: string | null
          candidate_id?: string
          config_snapshot?: Json | null
          consent_given_at?: string | null
          created_at?: string
          ended_at?: string | null
          final_decision?: string | null
          final_score?: number | null
          id?: string
          job_title?: string | null
          script_version?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "voice_interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
        ]
      }
    }
    Views: {
      ai_decisions: {
        Row: {
          actor_id: string | null
          application_id: string | null
          cpf: string | null
          created_at: string | null
          decision_type: string | null
          evaluation_id: string | null
          id: string | null
          input: Json | null
          model_provider: string | null
          model_version: string | null
          module: string | null
          output: Json | null
          processing_time_ms: number | null
          record_hash: string | null
        }
        Insert: {
          actor_id?: string | null
          application_id?: string | null
          cpf?: string | null
          created_at?: string | null
          decision_type?: string | null
          evaluation_id?: string | null
          id?: string | null
          input?: Json | null
          model_provider?: string | null
          model_version?: string | null
          module?: string | null
          output?: Json | null
          processing_time_ms?: number | null
          record_hash?: string | null
        }
        Update: {
          actor_id?: string | null
          application_id?: string | null
          cpf?: string | null
          created_at?: string | null
          decision_type?: string | null
          evaluation_id?: string | null
          id?: string | null
          input?: Json | null
          model_provider?: string | null
          model_version?: string | null
          module?: string | null
          output?: Json | null
          processing_time_ms?: number | null
          record_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_decision_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decision_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "ai_decision_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "ai_decision_logs_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "ai_evaluations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_prompts: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          prompt_text: string | null
          status: string | null
          target_scope: string | null
          version: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          prompt_text?: string | null
          status?: string | null
          target_scope?: string | null
          version?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          prompt_text?: string | null
          status?: string | null
          target_scope?: string | null
          version?: number | null
        }
        Relationships: []
      }
      ai_versions: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          prompt_text: string | null
          status: string | null
          target_scope: string | null
          version: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          prompt_text?: string | null
          status?: string | null
          target_scope?: string | null
          version?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          prompt_text?: string | null
          status?: string | null
          target_scope?: string | null
          version?: number | null
        }
        Relationships: []
      }
      audit_activity_view: {
        Row: {
          action: string | null
          created_at: string | null
          details: Json | null
          diff_after: string | null
          diff_before: string | null
          diff_json: Json | null
          id: string | null
          module: string | null
          record_hash: string | null
          user_id: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string | null
          details?: Json | null
          diff_after?: never
          diff_before?: never
          diff_json?: Json | null
          id?: string | null
          module?: string | null
          record_hash?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string | null
          details?: Json | null
          diff_after?: never
          diff_before?: never
          diff_json?: Json | null
          id?: string | null
          module?: string | null
          record_hash?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      audit_trails: {
        Row: {
          action: string | null
          actor_id: string | null
          context: Json | null
          created_at: string | null
          id: string | null
          ip_address: string | null
          record_hash: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action?: string | null
          actor_id?: string | null
          context?: Json | null
          created_at?: string | null
          id?: string | null
          ip_address?: string | null
          record_hash?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string | null
          actor_id?: string | null
          context?: Json | null
          created_at?: string | null
          id?: string | null
          ip_address?: string | null
          record_hash?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      candidate_unit_selection: {
        Row: {
          candidate_id: string | null
          created_at: string | null
          id: string | null
          origin: string | null
          selection_type: string | null
          unit_id: string | null
          unit_job_id: string | null
        }
        Insert: {
          candidate_id?: string | null
          created_at?: string | null
          id?: string | null
          origin?: string | null
          selection_type?: string | null
          unit_id?: string | null
          unit_job_id?: string | null
        }
        Update: {
          candidate_id?: string | null
          created_at?: string | null
          id?: string | null
          origin?: string | null
          selection_type?: string | null
          unit_id?: string | null
          unit_job_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_unit_selections_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_unit_selections_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_unit_selections_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_unit_selections_unit_job_id_fkey"
            columns: ["unit_job_id"]
            isOneToOne: false
            referencedRelation: "unit_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_unit_selections_unit_job_id_fkey"
            columns: ["unit_job_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["unit_job_id"]
          },
        ]
      }
      document_dispatch_audit: {
        Row: {
          actor_id: string | null
          brevo_message_id: string | null
          candidate_email: string | null
          candidate_id: string | null
          candidate_name: string | null
          delivered: boolean | null
          delivery_mode: string | null
          destination_email: string | null
          dispatched_at: string | null
          documents_count: number | null
          documents_sent: Json | null
          event: string | null
          id: string | null
          job_title: string | null
          request_id: string | null
          sent_at: string | null
          sent_by_name: string | null
          unit_name: string | null
        }
        Relationships: []
      }
      documents_requests: {
        Row: {
          application_id: string | null
          candidate_id: string | null
          completed_at: string | null
          created_at: string | null
          custom_documents: Json | null
          deadline_date: string | null
          documents_list: Json | null
          id: string | null
          job_id: string | null
          status: string | null
          unit_id: string | null
        }
        Insert: {
          application_id?: string | null
          candidate_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          custom_documents?: Json | null
          deadline_date?: string | null
          documents_list?: Json | null
          id?: string | null
          job_id?: string | null
          status?: string | null
          unit_id?: string | null
        }
        Update: {
          application_id?: string | null
          candidate_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          custom_documents?: Json | null
          deadline_date?: string | null
          documents_list?: Json | null
          id?: string | null
          job_id?: string | null
          status?: string | null
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_requests_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "document_requests_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "document_requests_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      documents_uploads: {
        Row: {
          candidate_id: string | null
          document_type: string | null
          file_url: string | null
          id: string | null
          rejection_reason: string | null
          request_id: string | null
          status: string | null
          uploaded_at: string | null
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          candidate_id?: string | null
          document_type?: string | null
          file_url?: string | null
          id?: string | null
          rejection_reason?: string | null
          request_id?: string | null
          status?: string | null
          uploaded_at?: string | null
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          candidate_id?: string | null
          document_type?: string | null
          file_url?: string | null
          id?: string | null
          rejection_reason?: string | null
          request_id?: string | null
          status?: string | null
          uploaded_at?: string | null
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_uploads_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_uploads_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_uploads_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "document_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_uploads_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "documents_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_uploads_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "hiring_status"
            referencedColumns: ["document_request_id"]
          },
        ]
      }
      hiring_status: {
        Row: {
          application_id: string | null
          application_status:
            | Database["public"]["Enums"]["application_status"]
            | null
          candidate_id: string | null
          completed_at: string | null
          document_request_id: string | null
          document_status: string | null
          job_id: string | null
          status_changed_at: string | null
          unit_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      interviews_for_whatsapp_notifications: {
        Row: {
          application_id: string | null
          candidate_id: string | null
          candidate_name: string | null
          confirmed_at: string | null
          interview_at_utc: string | null
          interview_datetime: string | null
          interview_id: string | null
          job_title: string | null
          meeting_link: string | null
          modality: string | null
          recipient_id: string | null
          recipient_phone: string | null
          reminder_sent: Json | null
          scheduled_date: string | null
          scheduled_time: string | null
          status: string | null
          unit_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "hiring_status"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "vw_link_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "interviews_candidate_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_candidate_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address_json: Json | null
          avatar_url: string | null
          birth_date: string | null
          cep: string | null
          city: string | null
          cpf: string | null
          created_at: string | null
          email: string | null
          ethnicity: string | null
          full_name: string | null
          gender: string | null
          id: string | null
          is_active: boolean | null
          latitude: number | null
          longitude: number | null
          opt_in_talent_pool: boolean | null
          phone: string | null
          professional_data: Json | null
          reactivation_date: string | null
          resume_url: string | null
          signature_url: string | null
          state: string | null
          status: Database["public"]["Enums"]["candidate_status"] | null
          status_changed_at: string | null
          status_reason: string | null
          updated_at: string | null
          user_status: Database["public"]["Enums"]["user_status"] | null
        }
        Insert: {
          address_json?: Json | null
          avatar_url?: string | null
          birth_date?: string | null
          cep?: string | null
          city?: string | null
          cpf?: string | null
          created_at?: string | null
          email?: string | null
          ethnicity?: string | null
          full_name?: string | null
          gender?: string | null
          id?: string | null
          is_active?: boolean | null
          latitude?: number | null
          longitude?: number | null
          opt_in_talent_pool?: boolean | null
          phone?: string | null
          professional_data?: Json | null
          reactivation_date?: string | null
          resume_url?: string | null
          signature_url?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["candidate_status"] | null
          status_changed_at?: string | null
          status_reason?: string | null
          updated_at?: string | null
          user_status?: Database["public"]["Enums"]["user_status"] | null
        }
        Update: {
          address_json?: Json | null
          avatar_url?: string | null
          birth_date?: string | null
          cep?: string | null
          city?: string | null
          cpf?: string | null
          created_at?: string | null
          email?: string | null
          ethnicity?: string | null
          full_name?: string | null
          gender?: string | null
          id?: string | null
          is_active?: boolean | null
          latitude?: number | null
          longitude?: number | null
          opt_in_talent_pool?: boolean | null
          phone?: string | null
          professional_data?: Json | null
          reactivation_date?: string | null
          resume_url?: string | null
          signature_url?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["candidate_status"] | null
          status_changed_at?: string | null
          status_reason?: string | null
          updated_at?: string | null
          user_status?: Database["public"]["Enums"]["user_status"] | null
        }
        Relationships: []
      }
      talent_pool: {
        Row: {
          approved_job_id: string | null
          candidate_id: string | null
          created_at: string | null
          entry_origin: string | null
          global_score: number | null
          id: string | null
          last_interaction: string | null
          last_job_id: string | null
          origin_unit_id: string | null
          preferred_regions: Json | null
          preferred_roles: Json | null
          score_breakdown: Json | null
          standby_reason: string | null
          status: Database["public"]["Enums"]["talent_pool_status"] | null
          test_completed_at: string | null
          test_details: Json | null
          test_score: number | null
          updated_at: string | null
        }
        Insert: {
          approved_job_id?: string | null
          candidate_id?: string | null
          created_at?: string | null
          entry_origin?: string | null
          global_score?: number | null
          id?: string | null
          last_interaction?: string | null
          last_job_id?: string | null
          origin_unit_id?: string | null
          preferred_regions?: Json | null
          preferred_roles?: Json | null
          score_breakdown?: Json | null
          standby_reason?: string | null
          status?: Database["public"]["Enums"]["talent_pool_status"] | null
          test_completed_at?: string | null
          test_details?: Json | null
          test_score?: number | null
          updated_at?: string | null
        }
        Update: {
          approved_job_id?: string | null
          candidate_id?: string | null
          created_at?: string | null
          entry_origin?: string | null
          global_score?: number | null
          id?: string | null
          last_interaction?: string | null
          last_job_id?: string | null
          origin_unit_id?: string | null
          preferred_regions?: Json | null
          preferred_roles?: Json | null
          score_breakdown?: Json | null
          standby_reason?: string | null
          status?: Database["public"]["Enums"]["talent_pool_status"] | null
          test_completed_at?: string | null
          test_details?: Json | null
          test_score?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "talent_pool_entries_approved_job_id_fkey"
            columns: ["approved_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "talent_pool_entries_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: true
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "talent_pool_entries_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "talent_pool_entries_last_job_id_fkey"
            columns: ["last_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "talent_pool_entries_origin_unit_id_fkey"
            columns: ["origin_unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_internal_users_safe: {
        Row: {
          cpf_hash: string | null
          cpf_masked: string | null
          created_at: string | null
          email: string | null
          id: string | null
          name: string | null
          phone: string | null
          role: string | null
          status: string | null
          unit_code: string | null
        }
        Insert: {
          cpf_hash?: string | null
          cpf_masked?: never
          created_at?: string | null
          email?: string | null
          id?: string | null
          name?: string | null
          phone?: string | null
          role?: string | null
          status?: string | null
          unit_code?: string | null
        }
        Update: {
          cpf_hash?: string | null
          cpf_masked?: never
          created_at?: string | null
          email?: string | null
          id?: string | null
          name?: string | null
          phone?: string | null
          role?: string | null
          status?: string | null
          unit_code?: string | null
        }
        Relationships: []
      }
      vw_link_application_funnel: {
        Row: {
          application_id: string | null
          candidate_id: string | null
          created_at: string | null
          job_id: string | null
          origin_campaign: string | null
          origin_channel: string | null
          origin_link_id: string | null
          reached_aprovado: boolean | null
          reached_contratado: boolean | null
          reached_interview: boolean | null
          reached_pendente: boolean | null
          reached_test: boolean | null
          status: string | null
          total_score: number | null
          unit_id: string | null
          unit_job_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_origin_link_id_fkey"
            columns: ["origin_link_id"]
            isOneToOne: false
            referencedRelation: "recruitment_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_jobs_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _diag_vault_lens: {
        Args: never
        Returns: {
          len: number
          name: string
          prefix: string
        }[]
      }
      admin_test_whatsapp_template: {
        Args: {
          p_components?: Json
          p_language?: string
          p_phone: string
          p_template_name: string
        }
        Returns: number
      }
      apply_via_link: { Args: { _token: string }; Returns: Json }
      auto_close_expired_corporate_jobs: { Args: never; Returns: undefined }
      available_candidates_in_radius: {
        Args: { p_job_id: string; p_radius_km?: number; p_unit_id: string }
        Returns: {
          avatar_url: string
          candidate_id: string
          city: string
          distance_km: number
          email: string
          full_name: string
          phone: string
          state: string
          test_completed_at: string
          test_score: number
        }[]
      }
      backfill_candidate_score_events: { Args: never; Returns: Json }
      cancel_pending_upload: { Args: { p_upload_id: string }; Returns: Json }
      check_and_alert_anomalies: { Args: never; Returns: undefined }
      check_cpf_status_rl: { Args: { _cpf: string }; Returns: Json }
      check_stalled_onboardings: { Args: never; Returns: undefined }
      choose_post_interview_modality: {
        Args: { p_application_id: string; p_modality: string }
        Returns: undefined
      }
      claim_notification_for_dispatch: {
        Args: { p_notification_id: string }
        Returns: boolean
      }
      cleanup_documents_without_approved_interview: {
        Args: { _application_id: string }
        Returns: undefined
      }
      cleanup_synthetic_data: { Args: never; Returns: Json }
      create_pipeline_with_first_phase: {
        Args: {
          _activate: boolean
          _job_id: string
          _min_score?: number
          _phase_kind?: string
          _phase_name: string
          _phase_type?: string
          _pipeline_name: string
        }
        Returns: {
          phase_id: string
          pipeline_id: string
        }[]
      }
      create_recruitment_link: {
        Args: {
          _campaign?: string
          _channel: Database["public"]["Enums"]["recruitment_link_channel"]
          _expires_at?: string
          _job_id: string
          _label?: string
          _unit_id: string
          _unit_job_id: string
        }
        Returns: {
          applications_count: number
          campaign: string | null
          channel: Database["public"]["Enums"]["recruitment_link_channel"]
          clicks_count: number
          created_at: string
          created_by: string
          deactivated_at: string | null
          deactivation_reason: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          job_id: string
          job_slug: string | null
          label: string | null
          short_code: string | null
          token: string
          unit_id: string
          unit_job_id: string | null
          unit_slug: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "recruitment_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_auth_session_id: { Args: never; Returns: string }
      current_candidate_is_internal_test: { Args: never; Returns: boolean }
      current_user_has_unit_role: {
        Args: { _unit_id: string }
        Returns: boolean
      }
      detect_access_anomalies:
        | {
            Args: never
            Returns: {
              anomaly_type: string
              details: Json
              user_id: string
            }[]
          }
        | {
            Args: { p_threshold?: number }
            Returns: {
              failed_count: number
              ip_address: string
              last_attempt: string
            }[]
          }
      detect_onboarding_abandonment: { Args: never; Returns: undefined }
      execute_cleanup_run_2026_04_30: { Args: never; Returns: Json }
      export_audit_with_hash:
        | {
            Args: { p_from?: string; p_module?: string; p_to?: string }
            Returns: {
              action_type: string
              actor_id: string
              actor_role: string
              created_at: string
              diff_json: Json
              entity_id: string
              entity_type: string
              hash_valid: boolean
              id: string
              record_hash: string
            }[]
          }
        | {
            Args: {
              p_date_from?: string
              p_date_to?: string
              p_limit?: number
              p_source?: string
            }
            Returns: Json
          }
      find_email_by_cpf: { Args: { _cpf: string }; Returns: Json }
      find_email_by_cpf_rl: { Args: { _cpf: string }; Returns: Json }
      fn_check_delayed_responses: { Args: never; Returns: undefined }
      generate_job_code: { Args: { _category: string }; Returns: string }
      generate_recruitment_link_token: { Args: never; Returns: string }
      get_admin_recipient_ids: {
        Args: { _unit_id?: string }
        Returns: string[]
      }
      get_admin_users: {
        Args: never
        Returns: {
          created_at: string
          email: string
          full_name: string
          is_active: boolean
          role: Database["public"]["Enums"]["app_role"]
          role_id: string
          scope_access: string
          unit_id: string
          unit_name: string
          user_id: string
        }[]
      }
      get_application_journey: {
        Args: { _application_id: string }
        Returns: {
          actor_role: string | null
          actor_user_id: string | null
          application_id: string
          candidate_id: string | null
          created_at: string
          cycle_number: number | null
          details: Json
          event_type: string
          from_status: string | null
          id: string
          origin_campaign: string | null
          origin_channel: string | null
          origin_link_id: string | null
          phase_id: string | null
          phase_kind: string | null
          phase_label: string | null
          score: number | null
          skip_reason: string | null
          skipped: boolean
          source: string | null
          to_status: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "application_journey_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_available_interview_times:
        | {
            Args: {
              _bypass_lead_time?: boolean
              _date: string
              _exclude_interview_id?: string
              _unit_id: string
            }
            Returns: {
              end_time: string
              modality: string
              slot_id: string
              start_time: string
            }[]
          }
        | {
            Args: {
              _bypass_lead_time?: boolean
              _date: string
              _exclude_interview_id?: string
              _purpose?: string
              _unit_id: string
            }
            Returns: {
              end_time: string
              modality: string
              slot_id: string
              start_time: string
            }[]
          }
        | {
            Args: { p_date: string; p_unit_id: string }
            Returns: {
              end_time: string
              modality: string
              slot_id: string
              start_time: string
            }[]
          }
      get_available_test_times: {
        Args: { p_date: string; p_unit_id: string }
        Returns: {
          end_time: string
          modality: string
          slot_id: string
          start_time: string
        }[]
      }
      get_chat_available_times: {
        Args: {
          _bypass_lead_time?: boolean
          _date: string
          _exclude_interview_id?: string
          _unit_id: string
        }
        Returns: {
          end_time: string
          slot_id: string
          start_time: string
        }[]
      }
      get_chat_unavailable_dates: {
        Args: {
          _bypass_lead_time?: boolean
          _days_ahead?: number
          _exclude_interview_id?: string
          _unit_id: string
        }
        Returns: {
          unavailable_date: string
        }[]
      }
      get_link_funnel_metrics: {
        Args: {
          _channel?: string
          _from?: string
          _job_id?: string
          _to?: string
          _unit_id?: string
        }
        Returns: {
          job_id: string
          job_title: string
          rate_aprovado: number
          rate_contratado: number
          rate_interview: number
          rate_test: number
          total_applied: number
          total_aprovado: number
          total_contratado: number
          total_interview: number
          total_pendente: number
          total_test: number
          unit_id: string
          unit_name: string
        }[]
      }
      get_link_funnel_summary: {
        Args: {
          _channel?: string
          _from?: string
          _job_id?: string
          _to?: string
          _unit_id?: string
        }
        Returns: {
          total_applied: number
          total_aprovado: number
          total_contratado: number
          total_interview: number
          total_pendente: number
          total_test: number
        }[]
      }
      get_my_interview_decisions: {
        Args: { p_application_id: string }
        Returns: {
          decision: string
          interview_id: string
        }[]
      }
      get_recruitment_links_metrics: {
        Args: {
          _campaign?: string
          _channel?: string
          _from?: string
          _job_id?: string
          _to?: string
          _unit_id?: string
        }
        Returns: {
          applications: number
          aprovado: number
          campaign: string
          channel: string
          clicks: number
          contratado: number
          conv_rate: number
          created_at: string
          deactivated_at: string
          desistente: number
          desligado: number
          em_andamento: number
          expires_at: string
          hire_rate: number
          is_active: boolean
          job_id: string
          job_title: string
          label: string
          link_id: string
          on_hold: number
          token: string
          unit_city: string
          unit_id: string
          unit_name: string
          unit_state: string
        }[]
      }
      get_unavailable_interview_dates:
        | {
            Args: {
              _bypass_lead_time?: boolean
              _days_ahead?: number
              _exclude_interview_id?: string
              _unit_id: string
            }
            Returns: {
              unavailable_date: string
            }[]
          }
        | {
            Args: {
              _bypass_lead_time?: boolean
              _days_ahead?: number
              _exclude_interview_id?: string
              _purpose?: string
              _unit_id: string
            }
            Returns: {
              unavailable_date: string
            }[]
          }
        | {
            Args: { p_days_ahead?: number; p_unit_id: string }
            Returns: string[]
          }
      get_unit_job_delete_impact: {
        Args: { _unit_job_id: string }
        Returns: Json
      }
      get_unit_schedule_group_ids: {
        Args: { _unit_id: string }
        Returns: string[]
      }
      get_user_unit_id: { Args: { _user_id: string }; Returns: string }
      get_users_last_login: {
        Args: { _user_ids: string[] }
        Returns: {
          email: string
          full_name: string
          last_login: string
          last_seen: string
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      identity_revoke_session: {
        Args: { _reason?: string; _session_id: string }
        Returns: undefined
      }
      increment_link_click: { Args: { _token: string }; Returns: undefined }
      insert_score_event: {
        Args: {
          p_candidate_id: string
          p_event_type: string
          p_metadata?: Json
          p_process_stage: string
          p_reason: string
          p_related_job_id: string
          p_score_delta: number
        }
        Returns: Json
      }
      is_application_interview_approved: {
        Args: { _application_id: string }
        Returns: boolean
      }
      is_identity_session_active: { Args: never; Returns: boolean }
      is_unit_override_authorized: {
        Args: { _unit_id: string }
        Returns: boolean
      }
      is_unit_recruiter: {
        Args: { _unit_id: string; _user_id: string }
        Returns: boolean
      }
      log_application_journey: {
        Args: {
          p_actor_role?: string
          p_actor_user_id?: string
          p_application_id: string
          p_details?: Json
          p_event_type: string
          p_from_status?: string
          p_origin_campaign?: string
          p_origin_channel?: string
          p_origin_link_id?: string
          p_phase_id?: string
          p_score?: number
          p_skip_reason?: string
          p_skipped?: boolean
          p_source?: string
          p_to_status?: string
        }
        Returns: string
      }
      log_blocked_document_attempt: {
        Args: {
          _application_id: string
          _candidate_id: string
          _table_name: string
        }
        Returns: undefined
      }
      lookup_cpf: { Args: { _cpf: string }; Returns: Json }
      match_talents: {
        Args: { _unit_job_id: string }
        Returns: {
          candidate_id: string
          city: string
          email: string
          full_name: string
          global_score: number
          state: string
        }[]
      }
      nearby_unit_jobs: {
        Args: { p_lat: number; p_lng: number; p_radius_km?: number }
        Returns: {
          distance_km: number
          unit_job_id: string
        }[]
      }
      provision_unit_defaults: {
        Args: { p_unit_id: string }
        Returns: undefined
      }
      rebuild_all_candidate_scores: { Args: never; Returns: Json }
      rebuild_candidate_score: {
        Args: { p_candidate_id: string }
        Returns: number
      }
      recompute_application_total_score: {
        Args: { p_application_id: string }
        Returns: undefined
      }
      record_failed_login: { Args: { _email: string }; Returns: number }
      register_document_upload: {
        Args: {
          p_document_type: string
          p_file_url: string
          p_request_id: string
        }
        Returns: {
          candidate_id: string
          document_type: string
          file_url: string
          id: string
          notes: string | null
          rejection_reason: string | null
          request_id: string
          status: string
          uploaded_at: string
          validated_at: string | null
          validated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "document_uploads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      register_push_token: {
        Args: { p_platform?: string; p_token: string }
        Returns: undefined
      }
      release_expired_locks: { Args: never; Returns: undefined }
      resend_notification_cascade: {
        Args: { p_notification_id: string }
        Returns: number
      }
      resolve_actor_roles_text: { Args: never; Returns: string }
      resolve_link_intent: { Args: { _token: string }; Returns: Json }
      resolve_token_by_slug: {
        Args: { _job_slug: string; _short_code: string; _unit_slug: string }
        Returns: string
      }
      restart_application_cycle: {
        Args: { p_actor: string; p_application_id: string; p_mode: string }
        Returns: Json
      }
      rl_hit: {
        Args: {
          _bucket: string
          _identifier: string
          _limit: number
          _window_seconds: number
        }
        Returns: boolean
      }
      sara_post_event: {
        Args: { _application_id: string; _kind: string; _payload?: Json }
        Returns: string
      }
      sara_tick: { Args: never; Returns: undefined }
      set_schedule_group_units: {
        Args: { _group_id: string; _unit_ids: string[] }
        Returns: number
      }
      slugify: { Args: { _input: string }; Returns: string }
      start_sara_onboarding: {
        Args: { _application_id: string }
        Returns: undefined
      }
      user_can_view_unit_metrics: {
        Args: { _unit_id: string }
        Returns: boolean
      }
      user_has_unit_access: {
        Args: { _unit_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "rh_franqueadora"
        | "gestor_recrutamento"
        | "franqueado"
        | "candidato"
        | "auditor_admin"
      application_status:
        | "pendente"
        | "em_andamento"
        | "apto_para_vaga"
        | "em_avaliacao"
        | "aprovado"
        | "reprovado"
        | "standby"
        | "desistente"
        | "contratado"
        | "pausado"
        | "desligado"
        | "declinado"
      candidate_status: "registered" | "in_process" | "hired" | "archived"
      identity_client_type: "web" | "mobile" | "api" | "integration"
      identity_device_trust_status:
        | "unknown"
        | "trusted"
        | "challenged"
        | "revoked"
      identity_session_status: "active" | "revoked" | "expired"
      recruitment_link_channel:
        | "whatsapp"
        | "instagram"
        | "facebook"
        | "tiktok"
        | "linkedin"
        | "email"
        | "qrcode_loja"
        | "indicacao"
        | "outro"
      step_type:
        | "texto"
        | "quiz"
        | "video"
        | "audio"
        | "imagem"
        | "entrevista_voz"
        | "entrevista_humana"
        | "misto"
      talent_invite_status: "pending" | "accepted" | "declined" | "expired"
      talent_pool_status:
        | "active"
        | "in_process"
        | "on_hold"
        | "hired"
        | "opt_out"
        | "archived"
      unit_job_status: "aberta" | "pausada" | "encerrada" | "preenchida"
      user_status: "ativo" | "suspenso" | "bloqueado" | "arquivado"
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
      app_role: [
        "admin",
        "rh_franqueadora",
        "gestor_recrutamento",
        "franqueado",
        "candidato",
        "auditor_admin",
      ],
      application_status: [
        "pendente",
        "em_andamento",
        "apto_para_vaga",
        "em_avaliacao",
        "aprovado",
        "reprovado",
        "standby",
        "desistente",
        "contratado",
        "pausado",
        "desligado",
        "declinado",
      ],
      candidate_status: ["registered", "in_process", "hired", "archived"],
      identity_client_type: ["web", "mobile", "api", "integration"],
      identity_device_trust_status: [
        "unknown",
        "trusted",
        "challenged",
        "revoked",
      ],
      identity_session_status: ["active", "revoked", "expired"],
      recruitment_link_channel: [
        "whatsapp",
        "instagram",
        "facebook",
        "tiktok",
        "linkedin",
        "email",
        "qrcode_loja",
        "indicacao",
        "outro",
      ],
      step_type: [
        "texto",
        "quiz",
        "video",
        "audio",
        "imagem",
        "entrevista_voz",
        "entrevista_humana",
        "misto",
      ],
      talent_invite_status: ["pending", "accepted", "declined", "expired"],
      talent_pool_status: [
        "active",
        "in_process",
        "on_hold",
        "hired",
        "opt_out",
        "archived",
      ],
      unit_job_status: ["aberta", "pausada", "encerrada", "preenchida"],
      user_status: ["ativo", "suspenso", "bloqueado", "arquivado"],
    },
  },
} as const
