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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      api_quotas: {
        Row: {
          configured: boolean
          daily_limit: number | null
          live_reserve_daily: number
          monthly_limit: number | null
          notes: string | null
          per_minute_limit: number | null
          provider: string
        }
        Insert: {
          configured?: boolean
          daily_limit?: number | null
          live_reserve_daily?: number
          monthly_limit?: number | null
          notes?: string | null
          per_minute_limit?: number | null
          provider: string
        }
        Update: {
          configured?: boolean
          daily_limit?: number | null
          live_reserve_daily?: number
          monthly_limit?: number | null
          notes?: string | null
          per_minute_limit?: number | null
          provider?: string
        }
        Relationships: []
      }
      api_usage: {
        Row: {
          calls: number
          category: string
          id: string
          period_month: string
          provider: string
        }
        Insert: {
          calls?: number
          category: string
          id?: string
          period_month: string
          provider: string
        }
        Update: {
          calls?: number
          category?: string
          id?: string
          period_month?: string
          provider?: string
        }
        Relationships: []
      }
      api_usage_daily: {
        Row: {
          calls: number
          category: string
          day: string
          id: string
          provider: string
        }
        Insert: {
          calls?: number
          category: string
          day: string
          id?: string
          provider: string
        }
        Update: {
          calls?: number
          category?: string
          day?: string
          id?: string
          provider?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          id: number
          max_users: number
          updated_at: string
        }
        Insert: {
          id?: number
          max_users?: number
          updated_at?: string
        }
        Update: {
          id?: number
          max_users?: number
          updated_at?: string
        }
        Relationships: []
      }
      blocked_emails: {
        Row: {
          blocked_at: string
          blocked_by: string | null
          email: string
        }
        Insert: {
          blocked_at?: string
          blocked_by?: string | null
          email: string
        }
        Update: {
          blocked_at?: string
          blocked_by?: string | null
          email?: string
        }
        Relationships: []
      }
      competition_follows: {
        Row: {
          competition_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_follows_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competitions: {
        Row: {
          country: string | null
          created_at: string
          current_season_id: string | null
          display_type: string | null
          external_id: string | null
          fetched_at: string | null
          home_advantage: number | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          name_en: string | null
          name_he: string
          season_calc_method: string
          sort_order: number | null
          source: string | null
          tournament_id: string | null
          updated_at: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          current_season_id?: string | null
          display_type?: string | null
          external_id?: string | null
          fetched_at?: string | null
          home_advantage?: number | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name_en?: string | null
          name_he: string
          season_calc_method: string
          sort_order?: number | null
          source?: string | null
          tournament_id?: string | null
          updated_at?: string
        }
        Update: {
          country?: string | null
          created_at?: string
          current_season_id?: string | null
          display_type?: string | null
          external_id?: string | null
          fetched_at?: string | null
          home_advantage?: number | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name_en?: string | null
          name_he?: string
          season_calc_method?: string
          sort_order?: number | null
          source?: string | null
          tournament_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          added_minute: number | null
          away_score: number | null
          created_at: string
          detail: string | null
          external_id: string | null
          home_score: number | null
          id: string
          match_id: string
          minute: number | null
          player_id: string | null
          related_player_id: string | null
          source: string | null
          team_id: string | null
          type: string | null
        }
        Insert: {
          added_minute?: number | null
          away_score?: number | null
          created_at?: string
          detail?: string | null
          external_id?: string | null
          home_score?: number | null
          id?: string
          match_id: string
          minute?: number | null
          player_id?: string | null
          related_player_id?: string | null
          source?: string | null
          team_id?: string | null
          type?: string | null
        }
        Update: {
          added_minute?: number | null
          away_score?: number | null
          created_at?: string
          detail?: string | null
          external_id?: string | null
          home_score?: number | null
          id?: string
          match_id?: string
          minute?: number | null
          player_id?: string | null
          related_player_id?: string | null
          source?: string | null
          team_id?: string | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_related_player_id_fkey"
            columns: ["related_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          job_name: string
          result_detail: Json | null
          result_metric: number | null
          started_at: string
          status: string | null
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          job_name: string
          result_detail?: Json | null
          result_metric?: number | null
          started_at?: string
          status?: string | null
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          job_name?: string
          result_detail?: Json | null
          result_metric?: number | null
          started_at?: string
          status?: string | null
        }
        Relationships: []
      }
      lineups: {
        Row: {
          created_at: string
          fetched_at: string | null
          formation: string | null
          id: string
          is_starting: boolean | null
          match_id: string
          player_id: string | null
          position: string | null
          shirt_number: number | null
          team_id: string | null
        }
        Insert: {
          created_at?: string
          fetched_at?: string | null
          formation?: string | null
          id?: string
          is_starting?: boolean | null
          match_id: string
          player_id?: string | null
          position?: string | null
          shirt_number?: number | null
          team_id?: string | null
        }
        Update: {
          created_at?: string
          fetched_at?: string | null
          formation?: string | null
          id?: string
          is_starting?: boolean | null
          match_id?: string
          player_id?: string | null
          position?: string | null
          shirt_number?: number | null
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lineups_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineups_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      match_stats: {
        Row: {
          fetched_at: string | null
          id: string
          match_id: string
          period: string | null
          stat_key: string | null
          stat_value: number | null
          team_id: string | null
        }
        Insert: {
          fetched_at?: string | null
          id?: string
          match_id: string
          period?: string | null
          stat_key?: string | null
          stat_value?: number | null
          team_id?: string | null
        }
        Update: {
          fetched_at?: string | null
          id?: string
          match_id?: string
          period?: string | null
          stat_key?: string | null
          stat_value?: number | null
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_stats_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          aggregate_away: number | null
          aggregate_home: number | null
          away_score: number | null
          away_team_id: string | null
          competition_id: string | null
          created_at: string
          external_id: string | null
          fetched_at: string | null
          home_score: number | null
          home_team_id: string | null
          id: string
          is_neutral: boolean
          is_qualifier: boolean
          kickoff_at: string | null
          leg: number | null
          live_source: string | null
          minute: number | null
          needs_review: boolean | null
          previous_leg_external_id: string | null
          round: string | null
          round_name: string | null
          round_number: number | null
          season: string | null
          source: string | null
          stage: string | null
          status: string | null
          tie_key: string | null
          time_confirmed: boolean
          updated_at: string
          venue: string | null
        }
        Insert: {
          aggregate_away?: number | null
          aggregate_home?: number | null
          away_score?: number | null
          away_team_id?: string | null
          competition_id?: string | null
          created_at?: string
          external_id?: string | null
          fetched_at?: string | null
          home_score?: number | null
          home_team_id?: string | null
          id?: string
          is_neutral?: boolean
          is_qualifier?: boolean
          kickoff_at?: string | null
          leg?: number | null
          live_source?: string | null
          minute?: number | null
          needs_review?: boolean | null
          previous_leg_external_id?: string | null
          round?: string | null
          round_name?: string | null
          round_number?: number | null
          season?: string | null
          source?: string | null
          stage?: string | null
          status?: string | null
          tie_key?: string | null
          time_confirmed?: boolean
          updated_at?: string
          venue?: string | null
        }
        Update: {
          aggregate_away?: number | null
          aggregate_home?: number | null
          away_score?: number | null
          away_team_id?: string | null
          competition_id?: string | null
          created_at?: string
          external_id?: string | null
          fetched_at?: string | null
          home_score?: number | null
          home_team_id?: string | null
          id?: string
          is_neutral?: boolean
          is_qualifier?: boolean
          kickoff_at?: string | null
          leg?: number | null
          live_source?: string | null
          minute?: number | null
          needs_review?: boolean | null
          previous_leg_external_id?: string | null
          round?: string | null
          round_name?: string | null
          round_number?: number | null
          season?: string | null
          source?: string | null
          stage?: string | null
          status?: string | null
          tie_key?: string | null
          time_confirmed?: boolean
          updated_at?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      news: {
        Row: {
          external_id: string | null
          fetched_at: string | null
          id: string
          image_url: string | null
          published_at: string | null
          source: string | null
          summary_he: string | null
          title_he: string | null
          url: string | null
        }
        Insert: {
          external_id?: string | null
          fetched_at?: string | null
          id?: string
          image_url?: string | null
          published_at?: string | null
          source?: string | null
          summary_he?: string | null
          title_he?: string | null
          url?: string | null
        }
        Update: {
          external_id?: string | null
          fetched_at?: string | null
          id?: string
          image_url?: string | null
          published_at?: string | null
          source?: string | null
          summary_he?: string | null
          title_he?: string | null
          url?: string | null
        }
        Relationships: []
      }
      notifications_sent: {
        Row: {
          id: string
          kind: string
          match_id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          id?: string
          kind: string
          match_id: string
          sent_at?: string
          user_id: string
        }
        Update: {
          id?: string
          kind?: string
          match_id?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_sent_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      player_photos: {
        Row: {
          cached_at: string
          id: string
          player_external_id: string | null
          source: string | null
          storage_path: string | null
        }
        Insert: {
          cached_at?: string
          id?: string
          player_external_id?: string | null
          source?: string | null
          storage_path?: string | null
        }
        Update: {
          cached_at?: string
          id?: string
          player_external_id?: string | null
          source?: string | null
          storage_path?: string | null
        }
        Relationships: []
      }
      player_ratings: {
        Row: {
          fetched_at: string | null
          id: string
          match_id: string
          player_id: string | null
          rating: number | null
          source: string | null
        }
        Insert: {
          fetched_at?: string | null
          id?: string
          match_id: string
          player_id?: string | null
          rating?: number | null
          source?: string | null
        }
        Update: {
          fetched_at?: string | null
          id?: string
          match_id?: string
          player_id?: string | null
          rating?: number | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_ratings_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_ratings_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          created_at: string
          external_id: string | null
          fetched_at: string | null
          id: string
          name_en: string | null
          name_he: string | null
          photo_checked_at: string | null
          photo_url: string | null
          position: string | null
          shirt_number: number | null
          source: string | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          fetched_at?: string | null
          id?: string
          name_en?: string | null
          name_he?: string | null
          photo_checked_at?: string | null
          photo_url?: string | null
          position?: string | null
          shirt_number?: number | null
          source?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_id?: string | null
          fetched_at?: string | null
          id?: string
          name_en?: string | null
          name_he?: string | null
          photo_checked_at?: string | null
          photo_url?: string | null
          position?: string | null
          shirt_number?: number | null
          source?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      predictions: {
        Row: {
          computed_at: string | null
          confidence: number | null
          created_at: string
          engine_version: string
          expected_total_goals: number | null
          explanation_he: string | null
          id: string
          lambda_away: number | null
          lambda_home: number | null
          match_id: string
          next_update_at: string | null
          predicted_away_score: number | null
          predicted_home_score: number | null
          prob_away: number | null
          prob_btts: number | null
          prob_draw: number | null
          prob_home: number | null
          prob_over_2_5: number | null
          prob_under_2_5: number | null
          reasons_he: Json | null
          score_matrix: Json | null
          updated_at: string
        }
        Insert: {
          computed_at?: string | null
          confidence?: number | null
          created_at?: string
          engine_version?: string
          expected_total_goals?: number | null
          explanation_he?: string | null
          id?: string
          lambda_away?: number | null
          lambda_home?: number | null
          match_id: string
          next_update_at?: string | null
          predicted_away_score?: number | null
          predicted_home_score?: number | null
          prob_away?: number | null
          prob_btts?: number | null
          prob_draw?: number | null
          prob_home?: number | null
          prob_over_2_5?: number | null
          prob_under_2_5?: number | null
          reasons_he?: Json | null
          score_matrix?: Json | null
          updated_at?: string
        }
        Update: {
          computed_at?: string | null
          confidence?: number | null
          created_at?: string
          engine_version?: string
          expected_total_goals?: number | null
          explanation_he?: string | null
          id?: string
          lambda_away?: number | null
          lambda_home?: number | null
          match_id?: string
          next_update_at?: string | null
          predicted_away_score?: number | null
          predicted_home_score?: number | null
          prob_away?: number | null
          prob_btts?: number | null
          prob_draw?: number | null
          prob_home?: number | null
          prob_over_2_5?: number | null
          prob_under_2_5?: number | null
          reasons_he?: Json | null
          score_matrix?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "predictions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: true
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          is_admin: boolean
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          is_admin?: boolean
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          is_admin?: boolean
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string | null
          created_at: string
          endpoint: string | null
          id: string
          p256dh: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth?: string | null
          created_at?: string
          endpoint?: string | null
          id?: string
          p256dh?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string | null
          created_at?: string
          endpoint?: string | null
          id?: string
          p256dh?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      source_permissions: {
        Row: {
          can_insert_competitions: boolean
          can_insert_matches: boolean
          can_insert_teams: boolean
          source: string
        }
        Insert: {
          can_insert_competitions?: boolean
          can_insert_matches?: boolean
          can_insert_teams?: boolean
          source: string
        }
        Update: {
          can_insert_competitions?: boolean
          can_insert_matches?: boolean
          can_insert_teams?: boolean
          source?: string
        }
        Relationships: []
      }
      standings: {
        Row: {
          competition_id: string | null
          computed_at: string | null
          drawn: number | null
          form: string | null
          goal_diff: number | null
          goals_against: number | null
          goals_for: number | null
          id: string
          lost: number | null
          played: number | null
          points: number | null
          position: number | null
          season: string | null
          team_id: string | null
          won: number | null
        }
        Insert: {
          competition_id?: string | null
          computed_at?: string | null
          drawn?: number | null
          form?: string | null
          goal_diff?: number | null
          goals_against?: number | null
          goals_for?: number | null
          id?: string
          lost?: number | null
          played?: number | null
          points?: number | null
          position?: number | null
          season?: string | null
          team_id?: string | null
          won?: number | null
        }
        Update: {
          competition_id?: string | null
          computed_at?: string | null
          drawn?: number | null
          form?: string | null
          goal_diff?: number | null
          goals_against?: number | null
          goals_for?: number | null
          id?: string
          lost?: number | null
          played?: number | null
          points?: number | null
          position?: number | null
          season?: string | null
          team_id?: string | null
          won?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "standings_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standings_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_aliases: {
        Row: {
          alias: string
          created_at: string
          id: string
          source: string
          team_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          source: string
          team_id: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          source?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_aliases_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_history: {
        Row: {
          category_name: string | null
          competition_name: string | null
          created_at: string
          external_id: string
          fetched_at: string
          goals_against: number | null
          goals_for: number | null
          id: string
          is_home: boolean
          opponent_external_id: string | null
          opponent_name: string | null
          played_at: string | null
          raw: Json | null
          result: string | null
          season: string | null
          source: string
          team_external_id: string
          tournament_id: string | null
          unique_tournament_id: string | null
          updated_at: string
        }
        Insert: {
          category_name?: string | null
          competition_name?: string | null
          created_at?: string
          external_id: string
          fetched_at?: string
          goals_against?: number | null
          goals_for?: number | null
          id?: string
          is_home: boolean
          opponent_external_id?: string | null
          opponent_name?: string | null
          played_at?: string | null
          raw?: Json | null
          result?: string | null
          season?: string | null
          source?: string
          team_external_id: string
          tournament_id?: string | null
          unique_tournament_id?: string | null
          updated_at?: string
        }
        Update: {
          category_name?: string | null
          competition_name?: string | null
          created_at?: string
          external_id?: string
          fetched_at?: string
          goals_against?: number | null
          goals_for?: number | null
          id?: string
          is_home?: boolean
          opponent_external_id?: string | null
          opponent_name?: string | null
          played_at?: string | null
          raw?: Json | null
          result?: string | null
          season?: string | null
          source?: string
          team_external_id?: string
          tournament_id?: string | null
          unique_tournament_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          clubelo_rating: number | null
          clubelo_updated_at: string | null
          country: string | null
          created_at: string
          elo: number | null
          external_id: string | null
          fetched_at: string | null
          history_checked_at: string | null
          id: string
          logo_checked_at: string | null
          logo_url: string | null
          name_en: string | null
          name_he: string | null
          short_name: string | null
          source: string | null
          updated_at: string
        }
        Insert: {
          clubelo_rating?: number | null
          clubelo_updated_at?: string | null
          country?: string | null
          created_at?: string
          elo?: number | null
          external_id?: string | null
          fetched_at?: string | null
          history_checked_at?: string | null
          id?: string
          logo_checked_at?: string | null
          logo_url?: string | null
          name_en?: string | null
          name_he?: string | null
          short_name?: string | null
          source?: string | null
          updated_at?: string
        }
        Update: {
          clubelo_rating?: number | null
          clubelo_updated_at?: string | null
          country?: string | null
          created_at?: string
          elo?: number | null
          external_id?: string | null
          fetched_at?: string | null
          history_checked_at?: string | null
          id?: string
          logo_checked_at?: string | null
          logo_url?: string | null
          name_en?: string | null
          name_he?: string | null
          short_name?: string | null
          source?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          chip_order: Json | null
          notifications_enabled: boolean | null
          notify_kickoff: boolean | null
          notify_lineups: boolean | null
          notify_result: boolean | null
          updated_at: string
          user_id: string
        }
        Insert: {
          chip_order?: Json | null
          notifications_enabled?: boolean | null
          notify_kickoff?: boolean | null
          notify_lineups?: boolean | null
          notify_result?: boolean | null
          updated_at?: string
          user_id: string
        }
        Update: {
          chip_order?: Json | null
          notifications_enabled?: boolean | null
          notify_kickoff?: boolean | null
          notify_lineups?: boolean | null
          notify_result?: boolean | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      api_budget_take: {
        Args: { p_category: string; p_count?: number; p_provider: string }
        Returns: boolean
      }
      compute_season: {
        Args: { kickoff: string; method: string }
        Returns: string
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
