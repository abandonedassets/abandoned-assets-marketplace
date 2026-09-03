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
      app_secrets: {
        Row: {
          name: string
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          name: string
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          name?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: []
      }
      asset_encumbrances: {
        Row: {
          agreed_price_usd: number | null
          back_taxes_usd: number
          created_at: string
          estoppel_status: string
          hoa_dues_usd: number
          holdback_usd: number
          id: string
          municipal_assessment_usd: number
          net_seller_payout_usd: number | null
          pipeline_item_id: string
          settled_at: string | null
          source: string
          total_encumbrance_usd: number
          updated_at: string
          utility_lien_usd: number
        }
        Insert: {
          agreed_price_usd?: number | null
          back_taxes_usd?: number
          created_at?: string
          estoppel_status?: string
          hoa_dues_usd?: number
          holdback_usd?: number
          id?: string
          municipal_assessment_usd?: number
          net_seller_payout_usd?: number | null
          pipeline_item_id: string
          settled_at?: string | null
          source?: string
          total_encumbrance_usd?: number
          updated_at?: string
          utility_lien_usd?: number
        }
        Update: {
          agreed_price_usd?: number | null
          back_taxes_usd?: number
          created_at?: string
          estoppel_status?: string
          hoa_dues_usd?: number
          holdback_usd?: number
          id?: string
          municipal_assessment_usd?: number
          net_seller_payout_usd?: number | null
          pipeline_item_id?: string
          settled_at?: string | null
          source?: string
          total_encumbrance_usd?: number
          updated_at?: string
          utility_lien_usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "asset_encumbrances_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_encumbrances_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_encumbrances_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_encumbrances_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_encumbrances_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_routing_rules: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          match_asset_type: string | null
          min_fee_usd: number | null
          name: string
          parcel_parity: string | null
          priority: number
          target_vault: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          match_asset_type?: string | null
          min_fee_usd?: number | null
          name: string
          parcel_parity?: string | null
          priority?: number
          target_vault: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          match_asset_type?: string | null
          min_fee_usd?: number | null
          name?: string
          parcel_parity?: string | null
          priority?: number
          target_vault?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_vault_exports: {
        Row: {
          created_at: string
          esign_id: string | null
          evidence_hash: string | null
          exported_at: string | null
          id: string
          last_error: string | null
          object_key: string
          pipeline_item_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          esign_id?: string | null
          evidence_hash?: string | null
          exported_at?: string | null
          id?: string
          last_error?: string | null
          object_key: string
          pipeline_item_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          esign_id?: string | null
          evidence_hash?: string | null
          exported_at?: string | null
          id?: string
          last_error?: string | null
          object_key?: string
          pipeline_item_id?: string | null
          status?: string
        }
        Relationships: []
      }
      bundles: {
        Row: {
          bulk_discount_pct: number
          created_at: string
          criteria: Json | null
          deal_count: number
          id: string
          institutional_tape: boolean
          name: string
          region_tag: string | null
          reserved_for_fund: string | null
          soft_lock_until: string | null
          status: string
          total_arv: number
          total_base: number
          total_fee: number
          updated_at: string
        }
        Insert: {
          bulk_discount_pct?: number
          created_at?: string
          criteria?: Json | null
          deal_count?: number
          id?: string
          institutional_tape?: boolean
          name: string
          region_tag?: string | null
          reserved_for_fund?: string | null
          soft_lock_until?: string | null
          status?: string
          total_arv?: number
          total_base?: number
          total_fee?: number
          updated_at?: string
        }
        Update: {
          bulk_discount_pct?: number
          created_at?: string
          criteria?: Json | null
          deal_count?: number
          id?: string
          institutional_tape?: boolean
          name?: string
          region_tag?: string | null
          reserved_for_fund?: string | null
          soft_lock_until?: string | null
          status?: string
          total_arv?: number
          total_base?: number
          total_fee?: number
          updated_at?: string
        }
        Relationships: []
      }
      buyer_buy_boxes: {
        Row: {
          active: boolean
          buyer_id: string
          buyer_priority: string | null
          capital_to_deploy_usd: number
          contact_email: string | null
          created_at: string
          debit_account_holder: string | null
          debit_account_number: string | null
          debit_mandate_signed_at: string | null
          debit_mandate_status: string
          debit_routing_number: string | null
          deprecated_at: string | null
          endpoint_checked_at: string | null
          endpoint_last_code: number | null
          endpoint_status: string
          exchange_deadline_at: string | null
          execution_mode: string
          id: string
          irs_identification_deadline: string | null
          is_1031_buyer: boolean
          label: string | null
          last_latency_strike_at: string | null
          last_sale_at: string | null
          latency_strikes: number
          legal_name: string | null
          m2m_api_key: string | null
          max_contract_price: number
          min_deal_size_usd: number | null
          min_discount_pct: number | null
          min_placement_margin: number
          mpc_emd_authorized: boolean
          mpc_signature_name: string | null
          mpc_signed_at: string | null
          partner_tax_id: string | null
          persona: Database["public"]["Enums"]["buyer_persona"]
          pre_binding_authorized: boolean
          public_key: string | null
          qi_entity: string | null
          radius_miles: number
          settlement_velocity_score: number | null
          specialized_asset_focus: string | null
          target_asset_types: string[]
          target_cap_rate_min: number | null
          target_states: string[]
          target_zip_codes: string[]
          total_claimed_locks: number | null
          total_completed_wires: number | null
          trading_desk_webhook: string | null
          updated_at: string
          urgency_score: number
          verification_tier: string
          webhook_url: string | null
          window_expiration: string | null
          window_start: string | null
        }
        Insert: {
          active?: boolean
          buyer_id?: string
          buyer_priority?: string | null
          capital_to_deploy_usd?: number
          contact_email?: string | null
          created_at?: string
          debit_account_holder?: string | null
          debit_account_number?: string | null
          debit_mandate_signed_at?: string | null
          debit_mandate_status?: string
          debit_routing_number?: string | null
          deprecated_at?: string | null
          endpoint_checked_at?: string | null
          endpoint_last_code?: number | null
          endpoint_status?: string
          exchange_deadline_at?: string | null
          execution_mode?: string
          id?: string
          irs_identification_deadline?: string | null
          is_1031_buyer?: boolean
          label?: string | null
          last_latency_strike_at?: string | null
          last_sale_at?: string | null
          latency_strikes?: number
          legal_name?: string | null
          m2m_api_key?: string | null
          max_contract_price: number
          min_deal_size_usd?: number | null
          min_discount_pct?: number | null
          min_placement_margin?: number
          mpc_emd_authorized?: boolean
          mpc_signature_name?: string | null
          mpc_signed_at?: string | null
          partner_tax_id?: string | null
          persona?: Database["public"]["Enums"]["buyer_persona"]
          pre_binding_authorized?: boolean
          public_key?: string | null
          qi_entity?: string | null
          radius_miles?: number
          settlement_velocity_score?: number | null
          specialized_asset_focus?: string | null
          target_asset_types?: string[]
          target_cap_rate_min?: number | null
          target_states?: string[]
          target_zip_codes?: string[]
          total_claimed_locks?: number | null
          total_completed_wires?: number | null
          trading_desk_webhook?: string | null
          updated_at?: string
          urgency_score?: number
          verification_tier?: string
          webhook_url?: string | null
          window_expiration?: string | null
          window_start?: string | null
        }
        Update: {
          active?: boolean
          buyer_id?: string
          buyer_priority?: string | null
          capital_to_deploy_usd?: number
          contact_email?: string | null
          created_at?: string
          debit_account_holder?: string | null
          debit_account_number?: string | null
          debit_mandate_signed_at?: string | null
          debit_mandate_status?: string
          debit_routing_number?: string | null
          deprecated_at?: string | null
          endpoint_checked_at?: string | null
          endpoint_last_code?: number | null
          endpoint_status?: string
          exchange_deadline_at?: string | null
          execution_mode?: string
          id?: string
          irs_identification_deadline?: string | null
          is_1031_buyer?: boolean
          label?: string | null
          last_latency_strike_at?: string | null
          last_sale_at?: string | null
          latency_strikes?: number
          legal_name?: string | null
          m2m_api_key?: string | null
          max_contract_price?: number
          min_deal_size_usd?: number | null
          min_discount_pct?: number | null
          min_placement_margin?: number
          mpc_emd_authorized?: boolean
          mpc_signature_name?: string | null
          mpc_signed_at?: string | null
          partner_tax_id?: string | null
          persona?: Database["public"]["Enums"]["buyer_persona"]
          pre_binding_authorized?: boolean
          public_key?: string | null
          qi_entity?: string | null
          radius_miles?: number
          settlement_velocity_score?: number | null
          specialized_asset_focus?: string | null
          target_asset_types?: string[]
          target_cap_rate_min?: number | null
          target_states?: string[]
          target_zip_codes?: string[]
          total_claimed_locks?: number | null
          total_completed_wires?: number | null
          trading_desk_webhook?: string | null
          updated_at?: string
          urgency_score?: number
          verification_tier?: string
          webhook_url?: string | null
          window_expiration?: string | null
          window_start?: string | null
        }
        Relationships: []
      }
      buyer_pof_verifications: {
        Row: {
          access_token: string | null
          account_mask: string | null
          available_usd: number | null
          buyer_email: string | null
          created_at: string
          esign_token: string | null
          id: string
          institution_name: string | null
          item_id: string | null
          last_error: string | null
          pipeline_item_id: string | null
          required_usd: number
          status: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          access_token?: string | null
          account_mask?: string | null
          available_usd?: number | null
          buyer_email?: string | null
          created_at?: string
          esign_token?: string | null
          id?: string
          institution_name?: string | null
          item_id?: string | null
          last_error?: string | null
          pipeline_item_id?: string | null
          required_usd?: number
          status?: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          access_token?: string | null
          account_mask?: string | null
          available_usd?: number | null
          buyer_email?: string | null
          created_at?: string
          esign_token?: string | null
          id?: string
          institution_name?: string | null
          item_id?: string | null
          last_error?: string | null
          pipeline_item_id?: string | null
          required_usd?: number
          status?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "buyer_pof_verifications_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyer_pof_verifications_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyer_pof_verifications_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyer_pof_verifications_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyer_pof_verifications_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      buyer_scorecards: {
        Row: {
          buyer_email: string
          clicks: number
          created_at: string
          deals_claimed: number
          deals_funded: number
          emd_timeouts: number
          id: string
          last_activity_at: string
          last_click_at: string | null
          last_event: string | null
          pof_failures: number
          reliability_score: number
          reservation_expirations: number
          tier: string
          updated_at: string
          velocity_score: number
        }
        Insert: {
          buyer_email: string
          clicks?: number
          created_at?: string
          deals_claimed?: number
          deals_funded?: number
          emd_timeouts?: number
          id?: string
          last_activity_at?: string
          last_click_at?: string | null
          last_event?: string | null
          pof_failures?: number
          reliability_score?: number
          reservation_expirations?: number
          tier?: string
          updated_at?: string
          velocity_score?: number
        }
        Update: {
          buyer_email?: string
          clicks?: number
          created_at?: string
          deals_claimed?: number
          deals_funded?: number
          emd_timeouts?: number
          id?: string
          last_activity_at?: string
          last_click_at?: string | null
          last_event?: string | null
          pof_failures?: number
          reliability_score?: number
          reservation_expirations?: number
          tier?: string
          updated_at?: string
          velocity_score?: number
        }
        Relationships: []
      }
      buyer_waitlist: {
        Row: {
          aum_bracket: string | null
          buyer_tier: string
          contact_email: string | null
          contact_mx_valid: boolean
          contact_phone: string | null
          contact_source: string | null
          contact_verified_at: string | null
          created_at: string
          deal_value: number
          estoppel_bundle: Json | null
          fund_name: string
          id: string
          impact_days: number
          is_stale: boolean
          lien_status_verified: boolean
          message: string | null
          source_ip: string | null
          status: string
          target_fee: number | null
          target_zips: string[]
          tarpit_strikes: number
          tarpit_until: string | null
          trading_desk_webhook: string | null
          updated_at: string
        }
        Insert: {
          aum_bracket?: string | null
          buyer_tier?: string
          contact_email?: string | null
          contact_mx_valid?: boolean
          contact_phone?: string | null
          contact_source?: string | null
          contact_verified_at?: string | null
          created_at?: string
          deal_value?: number
          estoppel_bundle?: Json | null
          fund_name: string
          id?: string
          impact_days?: number
          is_stale?: boolean
          lien_status_verified?: boolean
          message?: string | null
          source_ip?: string | null
          status?: string
          target_fee?: number | null
          target_zips?: string[]
          tarpit_strikes?: number
          tarpit_until?: string | null
          trading_desk_webhook?: string | null
          updated_at?: string
        }
        Update: {
          aum_bracket?: string | null
          buyer_tier?: string
          contact_email?: string | null
          contact_mx_valid?: boolean
          contact_phone?: string | null
          contact_source?: string | null
          contact_verified_at?: string | null
          created_at?: string
          deal_value?: number
          estoppel_bundle?: Json | null
          fund_name?: string
          id?: string
          impact_days?: number
          is_stale?: boolean
          lien_status_verified?: boolean
          message?: string | null
          source_ip?: string | null
          status?: string
          target_fee?: number | null
          target_zips?: string[]
          tarpit_strikes?: number
          tarpit_until?: string | null
          trading_desk_webhook?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      c2c_capital_pool: {
        Row: {
          api_key_id: string | null
          buyer_reference: string | null
          committed_usd: number
          created_at: string
          id: string
          pipeline_item_id: string
          status: string
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          api_key_id?: string | null
          buyer_reference?: string | null
          committed_usd?: number
          created_at?: string
          id?: string
          pipeline_item_id: string
          status?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          api_key_id?: string | null
          buyer_reference?: string | null
          committed_usd?: number
          created_at?: string
          id?: string
          pipeline_item_id?: string
          status?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "c2c_capital_pool_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "institutional_api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "c2c_capital_pool_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "c2c_capital_pool_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "c2c_capital_pool_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "c2c_capital_pool_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "c2c_capital_pool_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_deed_buyers: {
        Row: {
          alerts_sent: number
          asset_hint: string | null
          buyer_name: string
          city: string | null
          contact_email: string | null
          contact_phone: string | null
          county: string | null
          created_at: string
          deed_date: string | null
          id: string
          is_cash: boolean
          last_alerted_at: string | null
          purchase_amount: number | null
          purchases_90d: number
          raw: Json | null
          source: string
          source_url: string | null
          state: string | null
          updated_at: string
          zip: string
        }
        Insert: {
          alerts_sent?: number
          asset_hint?: string | null
          buyer_name: string
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          county?: string | null
          created_at?: string
          deed_date?: string | null
          id?: string
          is_cash?: boolean
          last_alerted_at?: string | null
          purchase_amount?: number | null
          purchases_90d?: number
          raw?: Json | null
          source?: string
          source_url?: string | null
          state?: string | null
          updated_at?: string
          zip: string
        }
        Update: {
          alerts_sent?: number
          asset_hint?: string | null
          buyer_name?: string
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          county?: string | null
          created_at?: string
          deed_date?: string | null
          id?: string
          is_cash?: boolean
          last_alerted_at?: string | null
          purchase_amount?: number | null
          purchases_90d?: number
          raw?: Json | null
          source?: string
          source_url?: string | null
          state?: string | null
          updated_at?: string
          zip?: string
        }
        Relationships: []
      }
      closing_pipeline_items: {
        Row: {
          absolute_floor_price: number | null
          acreage: number | null
          active_owner: string | null
          adaptive_reuse_by_right: boolean
          address: string | null
          adjacent_parcel_count: number
          algo_title_clear: boolean
          allocation_expires_at: string | null
          annual_property_tax: number | null
          apn: string | null
          arv_comp_count: number
          arv_source: string | null
          arv_updated_at: string | null
          assemblage_group_id: string | null
          assessed_value: number | null
          asset_category: string
          asset_class: string | null
          asset_type: string | null
          assignment_fee_authorized_at: string | null
          assignment_fee_authorized_usd: number | null
          assignment_fee_captured_at: string | null
          assignment_fee_intent_id: string | null
          assignment_fee_status: string | null
          auto_clearance_ready: boolean
          autopilot_state: string
          balance_due_usd: number | null
          balance_instructed_at: string | null
          balance_rail_ref: string | null
          balance_rail_status: string | null
          base_contract_price: number
          baths: number | null
          beds: number | null
          bundle_id: string | null
          buyer_channel: string | null
          buyer_tier_stage: string
          calculated_arv: number | null
          checkout_abandoned_at: string | null
          checkout_recovery_email_id: string | null
          checkout_recovery_email_to: string | null
          checkout_recovery_sent_at: string | null
          city: string | null
          clear_retry_count: number
          cleared_amount: number | null
          cleared_at: string | null
          closing_bundle_generated_at: string | null
          closing_bundle_hash: string | null
          closing_bundle_path: string | null
          closing_bundle_url: string | null
          compliance_tier: string | null
          composite_score: number | null
          confidence_score: number | null
          contract_payload: Json | null
          contract_state: string
          contract_structure: string | null
          county: string | null
          court_overbid_increment: number | null
          cre_class: Database["public"]["Enums"]["cre_asset_class"] | null
          cre_lane: string | null
          cre_package: string | null
          created_at: string
          data_fidelity_score: number
          days_owned: number | null
          debit_pull_at: string | null
          debit_pull_ref: string | null
          debit_pull_status: string
          debt_distress_flag: boolean
          debt_distress_reason: string | null
          debt_maturity_date: string | null
          dip_case_number: string | null
          dip_closing_deadline_at: string | null
          dip_court_district: string | null
          dip_free_and_clear: boolean
          dip_proposed_order_ref: string | null
          dip_sale_hearing_at: string | null
          dip_sale_motion_ref: string | null
          dscr: number | null
          dscr_breach: boolean
          dynamic_memo_id: string | null
          earnest_hold_status: string | null
          emd_amount: number | null
          emd_tier: string | null
          enrichment_tags: string[]
          entity_name: string | null
          env_flag_reason: string | null
          env_status: string | null
          erecording_blocked: boolean
          escrow_doc_path: string | null
          escrow_pending_at: string | null
          escrow_status: string | null
          estimated_cap_rate: number | null
          estimated_repairs: number
          estimated_stumpage_mbf: number | null
          exchange_deadline_at: string | null
          exchange_identified_at: string | null
          expense_ratio: number | null
          external_id: string | null
          far_potential: number | null
          fee_attribution: string | null
          fee_bps: number | null
          fee_decay_count: number
          flash_bridge_amount_usd: number | null
          flash_bridge_at: string | null
          flash_bridge_status: string
          has_garage: boolean | null
          has_signed_marketing_auth: boolean
          has_street_utilities: boolean
          has_timber: boolean
          held_until: string | null
          hoa_monthly: number | null
          house_bid_flagged_at: string | null
          id: string
          idempotency_key: string | null
          is_1031_candidate: boolean
          is_dip: boolean
          is_equitable_interest: boolean
          is_fee_positive: boolean
          is_held: boolean
          is_stale: boolean
          jv_fee_split_pct: number
          jv_partner_email: string | null
          jv_partner_id: string | null
          jv_partner_name: string | null
          last_resuscitated_at: string | null
          lien_search_result: Json | null
          lien_total: number | null
          like_kind_eligible: boolean
          liquidity_bucket: string
          liquidity_match_score: number
          liquidity_scored_at: string | null
          liquidity_tier: string | null
          lock_expires_at: string | null
          lock_phase: string | null
          locked_at: string | null
          locked_by_key_id: string | null
          lot_sqft: number | null
          m2m_asset_hash: string | null
          m2m_box_id: string | null
          m2m_dispatched_at: string | null
          m2m_expires_at: string | null
          m2m_handshake_deadline: string | null
          m2m_lock_ms: number
          manual_entered_at: string | null
          manual_review: boolean
          marketing_auth_signed_at: string | null
          matched_buy_box_id: string | null
          matched_buyer_id: string | null
          matched_fund_ids: string[]
          msa_distance_miles: number | null
          noi_usd: number | null
          notary_completed_at: string | null
          notary_ref: string | null
          notary_status: string
          notification_queued: boolean
          offer_expires_at: string | null
          offer_sent_at: string | null
          offer_stage: string
          optimized_acquisition_premium: number | null
          owner_acquired_at: string | null
          owner_entity: string | null
          parcel_number: string | null
          partner_share: number | null
          payout_at: string | null
          payout_provider: string | null
          payout_provider_transfer_id: string | null
          payout_status: string | null
          payout_transfer_id: string | null
          priority_override: boolean
          qi_entity: string | null
          rejected_at: string | null
          rejection_reason_code:
            | Database["public"]["Enums"]["offer_rejection_code"]
            | null
          rejection_target_price: number | null
          requires_legal_review: boolean
          reservation_email: string | null
          reservation_expires_at: string | null
          reservation_started_at: string | null
          resuscitation_count: number
          reverse_strike_ready: boolean
          risk_var_95: number | null
          routing_rule: string | null
          row_version: number
          seller_claimed_at: string | null
          seller_disbursed_at: string | null
          seller_disbursement_id: string | null
          seller_email: string | null
          seller_phone: string | null
          seller_routing_json: Json | null
          settlement_reference: string | null
          signed_contract_hash: string | null
          source: string
          source_system: string | null
          sovereign_override: boolean
          sovereign_override_at: string | null
          spread_multiplier: number
          spread_score: number | null
          sqft: number | null
          stale_at: string | null
          stalking_horse_bid: number | null
          state: string | null
          status: Database["public"]["Enums"]["app_pipeline_status"]
          stripe_session_expires_at: string | null
          stripe_session_id: string | null
          stripe_session_url: string | null
          suspended_at: string | null
          suspension_reason: string | null
          syndicated_at: string | null
          target_allocation_lane: string
          target_vault: string | null
          tax_burden_ratio: number | null
          tenant_credit_tier: string | null
          tif_cascade_count: number
          tif_dispatched_at: string | null
          tif_expires_at: string | null
          tif_offered_buyer_ids: string[]
          tif_state: string | null
          timber_density_score: number | null
          title_commitment_url: string | null
          title_company_of_record: Json | null
          title_escrow_file_number: string | null
          title_notes: string | null
          title_order_ref: string | null
          title_ordered_at: string | null
          title_risk_score: number | null
          title_status: Database["public"]["Enums"]["title_status_enum"] | null
          title_underwritten_at: string | null
          toll_amount_usd: number | null
          toll_buyer_key_id: string | null
          toll_intent_id: string | null
          toll_paid_at: string | null
          toll_session_url: string | null
          toll_status: string | null
          tracking_session_timeout: string | null
          updated_at: string
          user_id: string | null
          uw_ci_high: number | null
          uw_ci_low: number | null
          verification_status: string | null
          verified_counterparty_id: string | null
          virtual_funding_credit: number
          wale_years: number | null
          walt_years: number | null
          wire_instructed_at: string | null
          wire_instructions_sent_at: string | null
          wire_instructions_status: string | null
          wire_instructions_target: string | null
          year_built: number | null
          yield_class: string | null
          zip: string
          zoning_category: string | null
          zoning_class: string | null
        }
        Insert: {
          absolute_floor_price?: number | null
          acreage?: number | null
          active_owner?: string | null
          adaptive_reuse_by_right?: boolean
          address?: string | null
          adjacent_parcel_count?: number
          algo_title_clear?: boolean
          allocation_expires_at?: string | null
          annual_property_tax?: number | null
          apn?: string | null
          arv_comp_count?: number
          arv_source?: string | null
          arv_updated_at?: string | null
          assemblage_group_id?: string | null
          assessed_value?: number | null
          asset_category?: string
          asset_class?: string | null
          asset_type?: string | null
          assignment_fee_authorized_at?: string | null
          assignment_fee_authorized_usd?: number | null
          assignment_fee_captured_at?: string | null
          assignment_fee_intent_id?: string | null
          assignment_fee_status?: string | null
          auto_clearance_ready?: boolean
          autopilot_state?: string
          balance_due_usd?: number | null
          balance_instructed_at?: string | null
          balance_rail_ref?: string | null
          balance_rail_status?: string | null
          base_contract_price: number
          baths?: number | null
          beds?: number | null
          bundle_id?: string | null
          buyer_channel?: string | null
          buyer_tier_stage?: string
          calculated_arv?: number | null
          checkout_abandoned_at?: string | null
          checkout_recovery_email_id?: string | null
          checkout_recovery_email_to?: string | null
          checkout_recovery_sent_at?: string | null
          city?: string | null
          clear_retry_count?: number
          cleared_amount?: number | null
          cleared_at?: string | null
          closing_bundle_generated_at?: string | null
          closing_bundle_hash?: string | null
          closing_bundle_path?: string | null
          closing_bundle_url?: string | null
          compliance_tier?: string | null
          composite_score?: number | null
          confidence_score?: number | null
          contract_payload?: Json | null
          contract_state?: string
          contract_structure?: string | null
          county?: string | null
          court_overbid_increment?: number | null
          cre_class?: Database["public"]["Enums"]["cre_asset_class"] | null
          cre_lane?: string | null
          cre_package?: string | null
          created_at?: string
          data_fidelity_score?: number
          days_owned?: number | null
          debit_pull_at?: string | null
          debit_pull_ref?: string | null
          debit_pull_status?: string
          debt_distress_flag?: boolean
          debt_distress_reason?: string | null
          debt_maturity_date?: string | null
          dip_case_number?: string | null
          dip_closing_deadline_at?: string | null
          dip_court_district?: string | null
          dip_free_and_clear?: boolean
          dip_proposed_order_ref?: string | null
          dip_sale_hearing_at?: string | null
          dip_sale_motion_ref?: string | null
          dscr?: number | null
          dscr_breach?: boolean
          dynamic_memo_id?: string | null
          earnest_hold_status?: string | null
          emd_amount?: number | null
          emd_tier?: string | null
          enrichment_tags?: string[]
          entity_name?: string | null
          env_flag_reason?: string | null
          env_status?: string | null
          erecording_blocked?: boolean
          escrow_doc_path?: string | null
          escrow_pending_at?: string | null
          escrow_status?: string | null
          estimated_cap_rate?: number | null
          estimated_repairs?: number
          estimated_stumpage_mbf?: number | null
          exchange_deadline_at?: string | null
          exchange_identified_at?: string | null
          expense_ratio?: number | null
          external_id?: string | null
          far_potential?: number | null
          fee_attribution?: string | null
          fee_bps?: number | null
          fee_decay_count?: number
          flash_bridge_amount_usd?: number | null
          flash_bridge_at?: string | null
          flash_bridge_status?: string
          has_garage?: boolean | null
          has_signed_marketing_auth?: boolean
          has_street_utilities?: boolean
          has_timber?: boolean
          held_until?: string | null
          hoa_monthly?: number | null
          house_bid_flagged_at?: string | null
          id?: string
          idempotency_key?: string | null
          is_1031_candidate?: boolean
          is_dip?: boolean
          is_equitable_interest?: boolean
          is_fee_positive?: boolean
          is_held?: boolean
          is_stale?: boolean
          jv_fee_split_pct?: number
          jv_partner_email?: string | null
          jv_partner_id?: string | null
          jv_partner_name?: string | null
          last_resuscitated_at?: string | null
          lien_search_result?: Json | null
          lien_total?: number | null
          like_kind_eligible?: boolean
          liquidity_bucket?: string
          liquidity_match_score?: number
          liquidity_scored_at?: string | null
          liquidity_tier?: string | null
          lock_expires_at?: string | null
          lock_phase?: string | null
          locked_at?: string | null
          locked_by_key_id?: string | null
          lot_sqft?: number | null
          m2m_asset_hash?: string | null
          m2m_box_id?: string | null
          m2m_dispatched_at?: string | null
          m2m_expires_at?: string | null
          m2m_handshake_deadline?: string | null
          m2m_lock_ms?: number
          manual_entered_at?: string | null
          manual_review?: boolean
          marketing_auth_signed_at?: string | null
          matched_buy_box_id?: string | null
          matched_buyer_id?: string | null
          matched_fund_ids?: string[]
          msa_distance_miles?: number | null
          noi_usd?: number | null
          notary_completed_at?: string | null
          notary_ref?: string | null
          notary_status?: string
          notification_queued?: boolean
          offer_expires_at?: string | null
          offer_sent_at?: string | null
          offer_stage?: string
          optimized_acquisition_premium?: number | null
          owner_acquired_at?: string | null
          owner_entity?: string | null
          parcel_number?: string | null
          partner_share?: number | null
          payout_at?: string | null
          payout_provider?: string | null
          payout_provider_transfer_id?: string | null
          payout_status?: string | null
          payout_transfer_id?: string | null
          priority_override?: boolean
          qi_entity?: string | null
          rejected_at?: string | null
          rejection_reason_code?:
            | Database["public"]["Enums"]["offer_rejection_code"]
            | null
          rejection_target_price?: number | null
          requires_legal_review?: boolean
          reservation_email?: string | null
          reservation_expires_at?: string | null
          reservation_started_at?: string | null
          resuscitation_count?: number
          reverse_strike_ready?: boolean
          risk_var_95?: number | null
          routing_rule?: string | null
          row_version?: number
          seller_claimed_at?: string | null
          seller_disbursed_at?: string | null
          seller_disbursement_id?: string | null
          seller_email?: string | null
          seller_phone?: string | null
          seller_routing_json?: Json | null
          settlement_reference?: string | null
          signed_contract_hash?: string | null
          source?: string
          source_system?: string | null
          sovereign_override?: boolean
          sovereign_override_at?: string | null
          spread_multiplier?: number
          spread_score?: number | null
          sqft?: number | null
          stale_at?: string | null
          stalking_horse_bid?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["app_pipeline_status"]
          stripe_session_expires_at?: string | null
          stripe_session_id?: string | null
          stripe_session_url?: string | null
          suspended_at?: string | null
          suspension_reason?: string | null
          syndicated_at?: string | null
          target_allocation_lane?: string
          target_vault?: string | null
          tax_burden_ratio?: number | null
          tenant_credit_tier?: string | null
          tif_cascade_count?: number
          tif_dispatched_at?: string | null
          tif_expires_at?: string | null
          tif_offered_buyer_ids?: string[]
          tif_state?: string | null
          timber_density_score?: number | null
          title_commitment_url?: string | null
          title_company_of_record?: Json | null
          title_escrow_file_number?: string | null
          title_notes?: string | null
          title_order_ref?: string | null
          title_ordered_at?: string | null
          title_risk_score?: number | null
          title_status?: Database["public"]["Enums"]["title_status_enum"] | null
          title_underwritten_at?: string | null
          toll_amount_usd?: number | null
          toll_buyer_key_id?: string | null
          toll_intent_id?: string | null
          toll_paid_at?: string | null
          toll_session_url?: string | null
          toll_status?: string | null
          tracking_session_timeout?: string | null
          updated_at?: string
          user_id?: string | null
          uw_ci_high?: number | null
          uw_ci_low?: number | null
          verification_status?: string | null
          verified_counterparty_id?: string | null
          virtual_funding_credit?: number
          wale_years?: number | null
          walt_years?: number | null
          wire_instructed_at?: string | null
          wire_instructions_sent_at?: string | null
          wire_instructions_status?: string | null
          wire_instructions_target?: string | null
          year_built?: number | null
          yield_class?: string | null
          zip: string
          zoning_category?: string | null
          zoning_class?: string | null
        }
        Update: {
          absolute_floor_price?: number | null
          acreage?: number | null
          active_owner?: string | null
          adaptive_reuse_by_right?: boolean
          address?: string | null
          adjacent_parcel_count?: number
          algo_title_clear?: boolean
          allocation_expires_at?: string | null
          annual_property_tax?: number | null
          apn?: string | null
          arv_comp_count?: number
          arv_source?: string | null
          arv_updated_at?: string | null
          assemblage_group_id?: string | null
          assessed_value?: number | null
          asset_category?: string
          asset_class?: string | null
          asset_type?: string | null
          assignment_fee_authorized_at?: string | null
          assignment_fee_authorized_usd?: number | null
          assignment_fee_captured_at?: string | null
          assignment_fee_intent_id?: string | null
          assignment_fee_status?: string | null
          auto_clearance_ready?: boolean
          autopilot_state?: string
          balance_due_usd?: number | null
          balance_instructed_at?: string | null
          balance_rail_ref?: string | null
          balance_rail_status?: string | null
          base_contract_price?: number
          baths?: number | null
          beds?: number | null
          bundle_id?: string | null
          buyer_channel?: string | null
          buyer_tier_stage?: string
          calculated_arv?: number | null
          checkout_abandoned_at?: string | null
          checkout_recovery_email_id?: string | null
          checkout_recovery_email_to?: string | null
          checkout_recovery_sent_at?: string | null
          city?: string | null
          clear_retry_count?: number
          cleared_amount?: number | null
          cleared_at?: string | null
          closing_bundle_generated_at?: string | null
          closing_bundle_hash?: string | null
          closing_bundle_path?: string | null
          closing_bundle_url?: string | null
          compliance_tier?: string | null
          composite_score?: number | null
          confidence_score?: number | null
          contract_payload?: Json | null
          contract_state?: string
          contract_structure?: string | null
          county?: string | null
          court_overbid_increment?: number | null
          cre_class?: Database["public"]["Enums"]["cre_asset_class"] | null
          cre_lane?: string | null
          cre_package?: string | null
          created_at?: string
          data_fidelity_score?: number
          days_owned?: number | null
          debit_pull_at?: string | null
          debit_pull_ref?: string | null
          debit_pull_status?: string
          debt_distress_flag?: boolean
          debt_distress_reason?: string | null
          debt_maturity_date?: string | null
          dip_case_number?: string | null
          dip_closing_deadline_at?: string | null
          dip_court_district?: string | null
          dip_free_and_clear?: boolean
          dip_proposed_order_ref?: string | null
          dip_sale_hearing_at?: string | null
          dip_sale_motion_ref?: string | null
          dscr?: number | null
          dscr_breach?: boolean
          dynamic_memo_id?: string | null
          earnest_hold_status?: string | null
          emd_amount?: number | null
          emd_tier?: string | null
          enrichment_tags?: string[]
          entity_name?: string | null
          env_flag_reason?: string | null
          env_status?: string | null
          erecording_blocked?: boolean
          escrow_doc_path?: string | null
          escrow_pending_at?: string | null
          escrow_status?: string | null
          estimated_cap_rate?: number | null
          estimated_repairs?: number
          estimated_stumpage_mbf?: number | null
          exchange_deadline_at?: string | null
          exchange_identified_at?: string | null
          expense_ratio?: number | null
          external_id?: string | null
          far_potential?: number | null
          fee_attribution?: string | null
          fee_bps?: number | null
          fee_decay_count?: number
          flash_bridge_amount_usd?: number | null
          flash_bridge_at?: string | null
          flash_bridge_status?: string
          has_garage?: boolean | null
          has_signed_marketing_auth?: boolean
          has_street_utilities?: boolean
          has_timber?: boolean
          held_until?: string | null
          hoa_monthly?: number | null
          house_bid_flagged_at?: string | null
          id?: string
          idempotency_key?: string | null
          is_1031_candidate?: boolean
          is_dip?: boolean
          is_equitable_interest?: boolean
          is_fee_positive?: boolean
          is_held?: boolean
          is_stale?: boolean
          jv_fee_split_pct?: number
          jv_partner_email?: string | null
          jv_partner_id?: string | null
          jv_partner_name?: string | null
          last_resuscitated_at?: string | null
          lien_search_result?: Json | null
          lien_total?: number | null
          like_kind_eligible?: boolean
          liquidity_bucket?: string
          liquidity_match_score?: number
          liquidity_scored_at?: string | null
          liquidity_tier?: string | null
          lock_expires_at?: string | null
          lock_phase?: string | null
          locked_at?: string | null
          locked_by_key_id?: string | null
          lot_sqft?: number | null
          m2m_asset_hash?: string | null
          m2m_box_id?: string | null
          m2m_dispatched_at?: string | null
          m2m_expires_at?: string | null
          m2m_handshake_deadline?: string | null
          m2m_lock_ms?: number
          manual_entered_at?: string | null
          manual_review?: boolean
          marketing_auth_signed_at?: string | null
          matched_buy_box_id?: string | null
          matched_buyer_id?: string | null
          matched_fund_ids?: string[]
          msa_distance_miles?: number | null
          noi_usd?: number | null
          notary_completed_at?: string | null
          notary_ref?: string | null
          notary_status?: string
          notification_queued?: boolean
          offer_expires_at?: string | null
          offer_sent_at?: string | null
          offer_stage?: string
          optimized_acquisition_premium?: number | null
          owner_acquired_at?: string | null
          owner_entity?: string | null
          parcel_number?: string | null
          partner_share?: number | null
          payout_at?: string | null
          payout_provider?: string | null
          payout_provider_transfer_id?: string | null
          payout_status?: string | null
          payout_transfer_id?: string | null
          priority_override?: boolean
          qi_entity?: string | null
          rejected_at?: string | null
          rejection_reason_code?:
            | Database["public"]["Enums"]["offer_rejection_code"]
            | null
          rejection_target_price?: number | null
          requires_legal_review?: boolean
          reservation_email?: string | null
          reservation_expires_at?: string | null
          reservation_started_at?: string | null
          resuscitation_count?: number
          reverse_strike_ready?: boolean
          risk_var_95?: number | null
          routing_rule?: string | null
          row_version?: number
          seller_claimed_at?: string | null
          seller_disbursed_at?: string | null
          seller_disbursement_id?: string | null
          seller_email?: string | null
          seller_phone?: string | null
          seller_routing_json?: Json | null
          settlement_reference?: string | null
          signed_contract_hash?: string | null
          source?: string
          source_system?: string | null
          sovereign_override?: boolean
          sovereign_override_at?: string | null
          spread_multiplier?: number
          spread_score?: number | null
          sqft?: number | null
          stale_at?: string | null
          stalking_horse_bid?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["app_pipeline_status"]
          stripe_session_expires_at?: string | null
          stripe_session_id?: string | null
          stripe_session_url?: string | null
          suspended_at?: string | null
          suspension_reason?: string | null
          syndicated_at?: string | null
          target_allocation_lane?: string
          target_vault?: string | null
          tax_burden_ratio?: number | null
          tenant_credit_tier?: string | null
          tif_cascade_count?: number
          tif_dispatched_at?: string | null
          tif_expires_at?: string | null
          tif_offered_buyer_ids?: string[]
          tif_state?: string | null
          timber_density_score?: number | null
          title_commitment_url?: string | null
          title_company_of_record?: Json | null
          title_escrow_file_number?: string | null
          title_notes?: string | null
          title_order_ref?: string | null
          title_ordered_at?: string | null
          title_risk_score?: number | null
          title_status?: Database["public"]["Enums"]["title_status_enum"] | null
          title_underwritten_at?: string | null
          toll_amount_usd?: number | null
          toll_buyer_key_id?: string | null
          toll_intent_id?: string | null
          toll_paid_at?: string | null
          toll_session_url?: string | null
          toll_status?: string | null
          tracking_session_timeout?: string | null
          updated_at?: string
          user_id?: string | null
          uw_ci_high?: number | null
          uw_ci_low?: number | null
          verification_status?: string | null
          verified_counterparty_id?: string | null
          virtual_funding_credit?: number
          wale_years?: number | null
          walt_years?: number | null
          wire_instructed_at?: string | null
          wire_instructions_sent_at?: string | null
          wire_instructions_status?: string | null
          wire_instructions_target?: string | null
          year_built?: number | null
          yield_class?: string | null
          zip?: string
          zoning_category?: string | null
          zoning_class?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "closing_pipeline_items_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "closing_pipeline_items_idempotency_fk"
            columns: ["idempotency_key"]
            isOneToOne: true
            referencedRelation: "ingest_idempotency_keys"
            referencedColumns: ["hash"]
          },
          {
            foreignKeyName: "closing_pipeline_items_locked_by_key_id_fkey"
            columns: ["locked_by_key_id"]
            isOneToOne: false
            referencedRelation: "institutional_api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_events: {
        Row: {
          buyer_email: string | null
          channel: string | null
          created_at: string
          cryptographic_hash: string
          event: string
          fee_amount: number
          id: string
          impact_days: number
          lien_status_verified: boolean
          metadata: Json
          payout_cleared_at: string | null
          pipeline_item_id: string | null
          referer: string | null
          status: string
          tx_idempotency_key: string | null
          user_agent: string | null
        }
        Insert: {
          buyer_email?: string | null
          channel?: string | null
          created_at?: string
          cryptographic_hash: string
          event: string
          fee_amount?: number
          id?: string
          impact_days?: number
          lien_status_verified?: boolean
          metadata?: Json
          payout_cleared_at?: string | null
          pipeline_item_id?: string | null
          referer?: string | null
          status?: string
          tx_idempotency_key?: string | null
          user_agent?: string | null
        }
        Update: {
          buyer_email?: string | null
          channel?: string | null
          created_at?: string
          cryptographic_hash?: string
          event?: string
          fee_amount?: number
          id?: string
          impact_days?: number
          lien_status_verified?: boolean
          metadata?: Json
          payout_cleared_at?: string | null
          pipeline_item_id?: string | null
          referer?: string | null
          status?: string
          tx_idempotency_key?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversion_events_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_events_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_events_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_events_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_events_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_basis_ledger: {
        Row: {
          category: string
          created_at: string
          detail: Json
          fiscal_quarter: string
          harvested: boolean
          id: string
          micro_cost_usd: number
          pipeline_item_id: string | null
        }
        Insert: {
          category: string
          created_at?: string
          detail?: Json
          fiscal_quarter?: string
          harvested?: boolean
          id?: string
          micro_cost_usd?: number
          pipeline_item_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          detail?: Json
          fiscal_quarter?: string
          harvested?: boolean
          id?: string
          micro_cost_usd?: number
          pipeline_item_id?: string | null
        }
        Relationships: []
      }
      dark_cross_intents: {
        Row: {
          api_key_id: string | null
          auth_tag: string
          box_id: string | null
          ciphertext: string
          created_at: string
          cross_proof: string | null
          crossed_at: string | null
          crossed_deal_id: string | null
          expires_at: string
          id: string
          intent_hash: string
          iv: string
          max_notional: number
          status: string
          updated_at: string
        }
        Insert: {
          api_key_id?: string | null
          auth_tag: string
          box_id?: string | null
          ciphertext: string
          created_at?: string
          cross_proof?: string | null
          crossed_at?: string | null
          crossed_deal_id?: string | null
          expires_at?: string
          id?: string
          intent_hash: string
          iv: string
          max_notional?: number
          status?: string
          updated_at?: string
        }
        Update: {
          api_key_id?: string | null
          auth_tag?: string
          box_id?: string | null
          ciphertext?: string
          created_at?: string
          cross_proof?: string | null
          crossed_at?: string | null
          crossed_deal_id?: string | null
          expires_at?: string
          id?: string
          intent_hash?: string
          iv?: string
          max_notional?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dark_cross_intents_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "institutional_api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      dead_letter_payloads: {
        Row: {
          amount_cents: number | null
          apn: string | null
          created_at: string
          deal_id: string | null
          error_log: string | null
          event_id: string | null
          executed_at: string | null
          headers: Json | null
          id: string
          raw_body: string | null
          retry_count: number
          source: string
          status: string
          stripe_reference_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents?: number | null
          apn?: string | null
          created_at?: string
          deal_id?: string | null
          error_log?: string | null
          event_id?: string | null
          executed_at?: string | null
          headers?: Json | null
          id?: string
          raw_body?: string | null
          retry_count?: number
          source?: string
          status?: string
          stripe_reference_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number | null
          apn?: string | null
          created_at?: string
          deal_id?: string | null
          error_log?: string | null
          event_id?: string | null
          executed_at?: string | null
          headers?: Json | null
          id?: string
          raw_body?: string | null
          retry_count?: number
          source?: string
          status?: string
          stripe_reference_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      dead_letter_queue: {
        Row: {
          created_at: string
          error_reason: string | null
          id: string
          raw_payload: Json
          retry_count: number
          source_ip: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_reason?: string | null
          id?: string
          raw_payload: Json
          retry_count?: number
          source_ip?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_reason?: string | null
          id?: string
          raw_payload?: Json
          retry_count?: number
          source_ip?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      deal_feedback: {
        Row: {
          action: string
          api_key_id: string | null
          created_at: string
          fund_id: string | null
          id: string
          metadata: Json
          pipeline_item_id: string | null
          reason: string | null
          zip: string | null
        }
        Insert: {
          action: string
          api_key_id?: string | null
          created_at?: string
          fund_id?: string | null
          id?: string
          metadata?: Json
          pipeline_item_id?: string | null
          reason?: string | null
          zip?: string | null
        }
        Update: {
          action?: string
          api_key_id?: string | null
          created_at?: string
          fund_id?: string | null
          id?: string
          metadata?: Json
          pipeline_item_id?: string | null
          reason?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_feedback_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_feedback_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_feedback_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_feedback_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_feedback_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_dedupe: {
        Row: {
          buyer_id: string | null
          created_at: string
          id: string
          property_id: string
          recipient_email: string
        }
        Insert: {
          buyer_id?: string | null
          created_at?: string
          id?: string
          property_id: string
          recipient_email: string
        }
        Update: {
          buyer_id?: string | null
          created_at?: string
          id?: string
          property_id?: string
          recipient_email?: string
        }
        Relationships: []
      }
      dispatch_logs: {
        Row: {
          channel: string
          created_at: string
          detail: string | null
          endpoint_name: string | null
          endpoint_url: string | null
          http_status: number
          id: string
          latency_ms: number
          ok: boolean
          payload: Json | null
        }
        Insert: {
          channel?: string
          created_at?: string
          detail?: string | null
          endpoint_name?: string | null
          endpoint_url?: string | null
          http_status?: number
          id?: string
          latency_ms?: number
          ok?: boolean
          payload?: Json | null
        }
        Update: {
          channel?: string
          created_at?: string
          detail?: string | null
          endpoint_name?: string | null
          endpoint_url?: string | null
          http_status?: number
          id?: string
          latency_ms?: number
          ok?: boolean
          payload?: Json | null
        }
        Relationships: []
      }
      dispersed_quotes: {
        Row: {
          api_key_hash: string | null
          base_price: number
          created_at: string
          expires_at: string
          id: string
          markup_pct: number
          pipeline_item_id: string
          quoted_price: number
          updated_at: string
          webhook_id: string | null
        }
        Insert: {
          api_key_hash?: string | null
          base_price?: number
          created_at?: string
          expires_at?: string
          id?: string
          markup_pct?: number
          pipeline_item_id: string
          quoted_price?: number
          updated_at?: string
          webhook_id?: string | null
        }
        Update: {
          api_key_hash?: string | null
          base_price?: number
          created_at?: string
          expires_at?: string
          id?: string
          markup_pct?: number
          pipeline_item_id?: string
          quoted_price?: number
          updated_at?: string
          webhook_id?: string | null
        }
        Relationships: []
      }
      dlq_events: {
        Row: {
          attempts: number
          box_id: string | null
          created_at: string
          deal_id: string | null
          endpoint: string | null
          error_text: string | null
          http_status: number | null
          id: string
          next_retry_at: string
          payload: Json
          resolved_at: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          box_id?: string | null
          created_at?: string
          deal_id?: string | null
          endpoint?: string | null
          error_text?: string | null
          http_status?: number | null
          id?: string
          next_retry_at?: string
          payload?: Json
          resolved_at?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          box_id?: string | null
          created_at?: string
          deal_id?: string | null
          endpoint?: string | null
          error_text?: string | null
          http_status?: number | null
          id?: string
          next_retry_at?: string
          payload?: Json
          resolved_at?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      entity_contacts: {
        Row: {
          asset_id: string | null
          created_at: string
          discovered_email: string | null
          discovered_phone: string | null
          discovery_tier: string
          entity_name: string
          id: string
          jurisdiction: string | null
          mailing_address: string | null
          mx_host: string | null
          mx_valid: boolean
          principal_address: string | null
          raw: Json | null
          registered_agent: string | null
          registry_id: string | null
          source: string
          source_url: string | null
          updated_at: string
          verification_status: string
          verified_at: string | null
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          discovered_email?: string | null
          discovered_phone?: string | null
          discovery_tier: string
          entity_name: string
          id?: string
          jurisdiction?: string | null
          mailing_address?: string | null
          mx_host?: string | null
          mx_valid?: boolean
          principal_address?: string | null
          raw?: Json | null
          registered_agent?: string | null
          registry_id?: string | null
          source: string
          source_url?: string | null
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          discovered_email?: string | null
          discovered_phone?: string | null
          discovery_tier?: string
          entity_name?: string
          id?: string
          jurisdiction?: string | null
          mailing_address?: string | null
          mx_host?: string | null
          mx_valid?: boolean
          principal_address?: string | null
          raw?: Json | null
          registered_agent?: string | null
          registry_id?: string | null
          source?: string
          source_url?: string | null
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      escrow_injections: {
        Row: {
          created_at: string
          error: string | null
          http_status: number | null
          id: string
          order_ref: string | null
          pipeline_item_id: string | null
          provider: string
          request_payload: Json | null
          response_body: string | null
          status: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          http_status?: number | null
          id?: string
          order_ref?: string | null
          pipeline_item_id?: string | null
          provider?: string
          request_payload?: Json | null
          response_body?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          http_status?: number | null
          id?: string
          order_ref?: string | null
          pipeline_item_id?: string | null
          provider?: string
          request_payload?: Json | null
          response_body?: string | null
          status?: string
        }
        Relationships: []
      }
      escrow_orders: {
        Row: {
          circuit_state: string
          closing_disclosure_url: string | null
          contract_hash: string
          created_at: string
          deal_id: string | null
          failure_count: number
          hash_mismatch: boolean
          id: string
          last_ping_at: string | null
          last_response: Json | null
          next_ping_at: string | null
          opened_at: string | null
          order_status: string
          ping_count: number
          title_api_url: string | null
          title_company: string | null
          updated_at: string
        }
        Insert: {
          circuit_state?: string
          closing_disclosure_url?: string | null
          contract_hash: string
          created_at?: string
          deal_id?: string | null
          failure_count?: number
          hash_mismatch?: boolean
          id?: string
          last_ping_at?: string | null
          last_response?: Json | null
          next_ping_at?: string | null
          opened_at?: string | null
          order_status?: string
          ping_count?: number
          title_api_url?: string | null
          title_company?: string | null
          updated_at?: string
        }
        Update: {
          circuit_state?: string
          closing_disclosure_url?: string | null
          contract_hash?: string
          created_at?: string
          deal_id?: string | null
          failure_count?: number
          hash_mismatch?: boolean
          id?: string
          last_ping_at?: string | null
          last_response?: Json | null
          next_ping_at?: string | null
          opened_at?: string | null
          order_status?: string
          ping_count?: number
          title_api_url?: string | null
          title_company?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "escrow_orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escrow_orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escrow_orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escrow_orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escrow_orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      esign_requests: {
        Row: {
          ach_reminder_count: number
          assignment_fee: number | null
          blocked_at: string | null
          buyer_email: string
          buyer_entity: string | null
          created_at: string
          device_fingerprint: string | null
          emd_hold_amount: number
          emd_hold_authorized_at: string | null
          emd_hold_ref: string | null
          emd_hold_status: string
          id: string
          invoice_sent_at: string | null
          invoice_url: string | null
          last_ach_reminder_at: string | null
          nonrepudiation_hash: string | null
          nonrepudiation_sent_at: string | null
          ofac_result: Json | null
          ofac_screened_at: string | null
          ofac_status: string
          pipeline_item_id: string
          signed_at: string | null
          signer_ip: string | null
          signer_name: string | null
          signer_user_agent: string | null
          status: string
          token: string
          updated_at: string
          w9_certified_at: string | null
          w9_legal_name: string | null
          w9_tax_classification: string | null
          w9_tin_hash: string | null
          w9_tin_last4: string | null
        }
        Insert: {
          ach_reminder_count?: number
          assignment_fee?: number | null
          blocked_at?: string | null
          buyer_email: string
          buyer_entity?: string | null
          created_at?: string
          device_fingerprint?: string | null
          emd_hold_amount?: number
          emd_hold_authorized_at?: string | null
          emd_hold_ref?: string | null
          emd_hold_status?: string
          id?: string
          invoice_sent_at?: string | null
          invoice_url?: string | null
          last_ach_reminder_at?: string | null
          nonrepudiation_hash?: string | null
          nonrepudiation_sent_at?: string | null
          ofac_result?: Json | null
          ofac_screened_at?: string | null
          ofac_status?: string
          pipeline_item_id: string
          signed_at?: string | null
          signer_ip?: string | null
          signer_name?: string | null
          signer_user_agent?: string | null
          status?: string
          token: string
          updated_at?: string
          w9_certified_at?: string | null
          w9_legal_name?: string | null
          w9_tax_classification?: string | null
          w9_tin_hash?: string | null
          w9_tin_last4?: string | null
        }
        Update: {
          ach_reminder_count?: number
          assignment_fee?: number | null
          blocked_at?: string | null
          buyer_email?: string
          buyer_entity?: string | null
          created_at?: string
          device_fingerprint?: string | null
          emd_hold_amount?: number
          emd_hold_authorized_at?: string | null
          emd_hold_ref?: string | null
          emd_hold_status?: string
          id?: string
          invoice_sent_at?: string | null
          invoice_url?: string | null
          last_ach_reminder_at?: string | null
          nonrepudiation_hash?: string | null
          nonrepudiation_sent_at?: string | null
          ofac_result?: Json | null
          ofac_screened_at?: string | null
          ofac_status?: string
          pipeline_item_id?: string
          signed_at?: string | null
          signer_ip?: string | null
          signer_name?: string | null
          signer_user_agent?: string | null
          status?: string
          token?: string
          updated_at?: string
          w9_certified_at?: string | null
          w9_legal_name?: string | null
          w9_tax_classification?: string | null
          w9_tin_hash?: string | null
          w9_tin_last4?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esign_requests_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esign_requests_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esign_requests_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esign_requests_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esign_requests_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_metrics_snapshots: {
        Row: {
          captured_at: string
          fitness: number
          id: string
          metrics: Json
        }
        Insert: {
          captured_at?: string
          fitness?: number
          id?: string
          metrics?: Json
        }
        Update: {
          captured_at?: string
          fitness?: number
          id?: string
          metrics?: Json
        }
        Relationships: []
      }
      evolution_mutations: {
        Row: {
          baseline_metrics: Json
          created_at: string
          cycle_id: string
          defect_code: string
          fitness_delta: number | null
          hypothesis: string | null
          id: string
          knob: string
          new_value: number | null
          observed_metrics: Json
          prior_value: number | null
          rolled_back_at: string | null
          sandbox_passed: boolean
          status: string
          verified_at: string | null
        }
        Insert: {
          baseline_metrics?: Json
          created_at?: string
          cycle_id?: string
          defect_code: string
          fitness_delta?: number | null
          hypothesis?: string | null
          id?: string
          knob: string
          new_value?: number | null
          observed_metrics?: Json
          prior_value?: number | null
          rolled_back_at?: string | null
          sandbox_passed?: boolean
          status?: string
          verified_at?: string | null
        }
        Update: {
          baseline_metrics?: Json
          created_at?: string
          cycle_id?: string
          defect_code?: string
          fitness_delta?: number | null
          hypothesis?: string | null
          id?: string
          knob?: string
          new_value?: number | null
          observed_metrics?: Json
          prior_value?: number | null
          rolled_back_at?: string | null
          sandbox_passed?: boolean
          status?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      exception_queue: {
        Row: {
          base_contract_price: number | null
          confidence_score: number | null
          created_at: string
          id: string
          last_error: string | null
          last_retry_at: string | null
          pipeline_item_id: string
          resolution: string | null
          resolved_at: string | null
          retry_count: number
          updated_at: string
          zip: string | null
        }
        Insert: {
          base_contract_price?: number | null
          confidence_score?: number | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_retry_at?: string | null
          pipeline_item_id: string
          resolution?: string | null
          resolved_at?: string | null
          retry_count?: number
          updated_at?: string
          zip?: string | null
        }
        Update: {
          base_contract_price?: number | null
          confidence_score?: number | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_retry_at?: string | null
          pipeline_item_id?: string
          resolution?: string | null
          resolved_at?: string | null
          retry_count?: number
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exception_queue_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exception_queue_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exception_queue_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exception_queue_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exception_queue_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_dlq: {
        Row: {
          client_txn_id: string | null
          created_at: string
          deal_id: string | null
          detail: Json
          id: string
          reason: string
          replay_attempts: number
          resolved: boolean
          resolved_at: string | null
        }
        Insert: {
          client_txn_id?: string | null
          created_at?: string
          deal_id?: string | null
          detail?: Json
          id?: string
          reason: string
          replay_attempts?: number
          resolved?: boolean
          resolved_at?: string | null
        }
        Update: {
          client_txn_id?: string | null
          created_at?: string
          deal_id?: string | null
          detail?: Json
          id?: string
          reason?: string
          replay_attempts?: number
          resolved?: boolean
          resolved_at?: string | null
        }
        Relationships: []
      }
      fee_escrow_locks: {
        Row: {
          api_key_id: string | null
          assignment_fee: number
          capital_token_hash: string | null
          clearing_network: string | null
          client_txn_id: string
          counterparty: string | null
          deal_id: string
          id: string
          lock_state: string
          locked_at: string
          notional: number
          reconciled_at: string | null
          seal_hash: string
          swept_at: string | null
          variance: number
        }
        Insert: {
          api_key_id?: string | null
          assignment_fee?: number
          capital_token_hash?: string | null
          clearing_network?: string | null
          client_txn_id: string
          counterparty?: string | null
          deal_id: string
          id?: string
          lock_state?: string
          locked_at?: string
          notional?: number
          reconciled_at?: string | null
          seal_hash: string
          swept_at?: string | null
          variance?: number
        }
        Update: {
          api_key_id?: string | null
          assignment_fee?: number
          capital_token_hash?: string | null
          clearing_network?: string | null
          client_txn_id?: string
          counterparty?: string | null
          deal_id?: string
          id?: string
          lock_state?: string
          locked_at?: string
          notional?: number
          reconciled_at?: string | null
          seal_hash?: string
          swept_at?: string | null
          variance?: number
        }
        Relationships: []
      }
      gate_resolution_state: {
        Row: {
          attempts: number
          created_at: string
          external_ref: string | null
          gate: string
          id: string
          last_attempt_at: string | null
          last_detail: string | null
          next_attempt_at: string
          pipeline_item_id: string
          state: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          external_ref?: string | null
          gate: string
          id?: string
          last_attempt_at?: string | null
          last_detail?: string | null
          next_attempt_at?: string
          pipeline_item_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          external_ref?: string | null
          gate?: string
          id?: string
          last_attempt_at?: string | null
          last_detail?: string | null
          next_attempt_at?: string
          pipeline_item_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gate_resolution_state_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_resolution_state_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_resolution_state_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_resolution_state_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_resolution_state_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_email_log: {
        Row: {
          action_taken: string | null
          body_preview: string | null
          created_at: string
          detected_intent: string | null
          from_email: string | null
          id: string
          matched_item_id: string | null
          raw: Json | null
          subject: string | null
          updated_at: string
        }
        Insert: {
          action_taken?: string | null
          body_preview?: string | null
          created_at?: string
          detected_intent?: string | null
          from_email?: string | null
          id?: string
          matched_item_id?: string | null
          raw?: Json | null
          subject?: string | null
          updated_at?: string
        }
        Update: {
          action_taken?: string | null
          body_preview?: string | null
          created_at?: string
          detected_intent?: string | null
          from_email?: string | null
          id?: string
          matched_item_id?: string | null
          raw?: Json | null
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      inbound_wire_accounts: {
        Row: {
          bank_name: string
          created_at: string
          expected_amount: number | null
          fbo_account_number: string
          fbo_name: string
          funded_amount: number | null
          funded_at: string | null
          id: string
          pipeline_item_id: string
          provider: string
          provider_account_number_id: string | null
          provider_bank_account_id: string | null
          routing_number: string
          status: string
          updated_at: string
        }
        Insert: {
          bank_name: string
          created_at?: string
          expected_amount?: number | null
          fbo_account_number: string
          fbo_name: string
          funded_amount?: number | null
          funded_at?: string | null
          id?: string
          pipeline_item_id: string
          provider?: string
          provider_account_number_id?: string | null
          provider_bank_account_id?: string | null
          routing_number: string
          status?: string
          updated_at?: string
        }
        Update: {
          bank_name?: string
          created_at?: string
          expected_amount?: number | null
          fbo_account_number?: string
          fbo_name?: string
          funded_amount?: number | null
          funded_at?: string | null
          id?: string
          pipeline_item_id?: string
          provider?: string
          provider_account_number_id?: string | null
          provider_bank_account_id?: string | null
          routing_number?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_wire_accounts_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_wire_accounts_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_wire_accounts_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_wire_accounts_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_wire_accounts_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_wire_events: {
        Row: {
          amount_usd: number | null
          created_at: string
          event_id: string | null
          fbo_account_number: string | null
          id: string
          match_status: string
          matched_item_id: string | null
          raw: Json
          reason: string | null
          sender_reference: string | null
        }
        Insert: {
          amount_usd?: number | null
          created_at?: string
          event_id?: string | null
          fbo_account_number?: string | null
          id?: string
          match_status?: string
          matched_item_id?: string | null
          raw?: Json
          reason?: string | null
          sender_reference?: string | null
        }
        Update: {
          amount_usd?: number | null
          created_at?: string
          event_id?: string | null
          fbo_account_number?: string | null
          id?: string
          match_status?: string
          matched_item_id?: string | null
          raw?: Json
          reason?: string | null
          sender_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_wire_events_matched_item_id_fkey"
            columns: ["matched_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_wire_events_matched_item_id_fkey"
            columns: ["matched_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_wire_events_matched_item_id_fkey"
            columns: ["matched_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_wire_events_matched_item_id_fkey"
            columns: ["matched_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_wire_events_matched_item_id_fkey"
            columns: ["matched_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_idempotency_keys: {
        Row: {
          hash: string
          seen_at: string
          source: string
        }
        Insert: {
          hash: string
          seen_at?: string
          source: string
        }
        Update: {
          hash?: string
          seen_at?: string
          source?: string
        }
        Relationships: []
      }
      ingest_runs: {
        Row: {
          created_at: string
          deduped: number | null
          dlq: number | null
          id: string
          inserted: number | null
          note: string | null
          source: string
          status: string
          total_rows: number | null
        }
        Insert: {
          created_at?: string
          deduped?: number | null
          dlq?: number | null
          id?: string
          inserted?: number | null
          note?: string | null
          source: string
          status: string
          total_rows?: number | null
        }
        Update: {
          created_at?: string
          deduped?: number | null
          dlq?: number | null
          id?: string
          inserted?: number | null
          note?: string | null
          source?: string
          status?: string
          total_rows?: number | null
        }
        Relationships: []
      }
      institutional_api_keys: {
        Row: {
          blacklisted_at: string | null
          cancellation_count: number
          created_at: string
          ecdsa_public_key: string | null
          first_intent_at: string | null
          fund_id: string | null
          hmac_secret: string | null
          id: string
          is_active: boolean
          key_hash: string
          key_prefix: string
          label: string
          last_ip_subnet: string | null
          last_used_at: string | null
          liquidity_score: number
          onboarding_state: string
          production_enabled_at: string | null
          rate_limit_per_minute: number
          require_asymmetric: boolean
          sandbox: boolean
          uat_verified_at: string | null
          updated_at: string
        }
        Insert: {
          blacklisted_at?: string | null
          cancellation_count?: number
          created_at?: string
          ecdsa_public_key?: string | null
          first_intent_at?: string | null
          fund_id?: string | null
          hmac_secret?: string | null
          id?: string
          is_active?: boolean
          key_hash: string
          key_prefix: string
          label: string
          last_ip_subnet?: string | null
          last_used_at?: string | null
          liquidity_score?: number
          onboarding_state?: string
          production_enabled_at?: string | null
          rate_limit_per_minute?: number
          require_asymmetric?: boolean
          sandbox?: boolean
          uat_verified_at?: string | null
          updated_at?: string
        }
        Update: {
          blacklisted_at?: string | null
          cancellation_count?: number
          created_at?: string
          ecdsa_public_key?: string | null
          first_intent_at?: string | null
          fund_id?: string | null
          hmac_secret?: string | null
          id?: string
          is_active?: boolean
          key_hash?: string
          key_prefix?: string
          label?: string
          last_ip_subnet?: string | null
          last_used_at?: string | null
          liquidity_score?: number
          onboarding_state?: string
          production_enabled_at?: string | null
          rate_limit_per_minute?: number
          require_asymmetric?: boolean
          sandbox?: boolean
          uat_verified_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "institutional_api_keys_fund_id_fkey"
            columns: ["fund_id"]
            isOneToOne: false
            referencedRelation: "institutional_buy_boxes"
            referencedColumns: ["id"]
          },
        ]
      }
      institutional_api_request_log: {
        Row: {
          api_key_id: string | null
          endpoint: string
          http_status: number
          id: string
          requested_at: string
        }
        Insert: {
          api_key_id?: string | null
          endpoint: string
          http_status: number
          id?: string
          requested_at?: string
        }
        Update: {
          api_key_id?: string | null
          endpoint?: string
          http_status?: number
          id?: string
          requested_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "institutional_api_request_log_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "institutional_api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      institutional_buy_boxes: {
        Row: {
          created_at: string
          fund_name: string
          id: string
          is_active: boolean
          max_hoa_monthly: number
          max_repair_budget: number
          min_baths: number
          min_beds: number
          min_cap_rate: number
          min_sqft: number
          min_year_built: number
          requires_garage: boolean
          target_zips: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          fund_name: string
          id?: string
          is_active?: boolean
          max_hoa_monthly?: number
          max_repair_budget?: number
          min_baths?: number
          min_beds?: number
          min_cap_rate?: number
          min_sqft?: number
          min_year_built?: number
          requires_garage?: boolean
          target_zips?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          fund_name?: string
          id?: string
          is_active?: boolean
          max_hoa_monthly?: number
          max_repair_budget?: number
          min_baths?: number
          min_beds?: number
          min_cap_rate?: number
          min_sqft?: number
          min_year_built?: number
          requires_garage?: boolean
          target_zips?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      institutional_webhooks: {
        Row: {
          active: boolean
          api_key_hash: string | null
          auth_header: string
          consecutive_failures: number
          created_at: string
          discovery_domain: string | null
          endpoint_url: string
          expires_at: string | null
          id: string
          key_extended_at: string | null
          label: string
          last_dispatch_at: string | null
          last_status: string | null
          max_deal_size_usd: number | null
          min_deal_size_usd: number | null
          outbound_api_key: string | null
          schema_map: Json | null
          schema_url: string | null
          status: string
          target_asset_classes: string[] | null
          trading_desk_webhook: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          api_key_hash?: string | null
          auth_header?: string
          consecutive_failures?: number
          created_at?: string
          discovery_domain?: string | null
          endpoint_url: string
          expires_at?: string | null
          id?: string
          key_extended_at?: string | null
          label: string
          last_dispatch_at?: string | null
          last_status?: string | null
          max_deal_size_usd?: number | null
          min_deal_size_usd?: number | null
          outbound_api_key?: string | null
          schema_map?: Json | null
          schema_url?: string | null
          status?: string
          target_asset_classes?: string[] | null
          trading_desk_webhook?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          api_key_hash?: string | null
          auth_header?: string
          consecutive_failures?: number
          created_at?: string
          discovery_domain?: string | null
          endpoint_url?: string
          expires_at?: string | null
          id?: string
          key_extended_at?: string | null
          label?: string
          last_dispatch_at?: string | null
          last_status?: string | null
          max_deal_size_usd?: number | null
          min_deal_size_usd?: number | null
          outbound_api_key?: string | null
          schema_map?: Json | null
          schema_url?: string | null
          status?: string
          target_asset_classes?: string[] | null
          trading_desk_webhook?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      internal_beneficiary_allocations: {
        Row: {
          amount_usd: number
          beneficiary_key: string
          beneficiary_label: string
          created_at: string
          dispatch_rail: string | null
          external_transfer_id: string | null
          id: string
          pct: number
          pipeline_item_id: string | null
          reason: string | null
          recipient_profile_id: string | null
          settled_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_usd?: number
          beneficiary_key: string
          beneficiary_label: string
          created_at?: string
          dispatch_rail?: string | null
          external_transfer_id?: string | null
          id?: string
          pct?: number
          pipeline_item_id?: string | null
          reason?: string | null
          recipient_profile_id?: string | null
          settled_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_usd?: number
          beneficiary_key?: string
          beneficiary_label?: string
          created_at?: string
          dispatch_rail?: string | null
          external_transfer_id?: string | null
          id?: string
          pct?: number
          pipeline_item_id?: string | null
          reason?: string | null
          recipient_profile_id?: string | null
          settled_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_beneficiary_allocations_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_beneficiary_allocations_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_beneficiary_allocations_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_beneficiary_allocations_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_beneficiary_allocations_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_beneficiary_allocations_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "payout_recipient_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_anomalies: {
        Row: {
          anomaly_code: string
          created_at: string
          details: Json
          first_detected_at: string
          id: string
          last_detected_at: string
          message: string
          pipeline_item_id: string | null
          resolved_at: string | null
          severity: string
          status: string
          updated_at: string
        }
        Insert: {
          anomaly_code: string
          created_at?: string
          details?: Json
          first_detected_at?: string
          id?: string
          last_detected_at?: string
          message: string
          pipeline_item_id?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Update: {
          anomaly_code?: string
          created_at?: string
          details?: Json
          first_detected_at?: string
          id?: string
          last_detected_at?: string
          message?: string
          pipeline_item_id?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_anomalies_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_anomalies_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_anomalies_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_anomalies_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_anomalies_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      m2m_bids: {
        Row: {
          auction_window_id: string | null
          bid_amount: number
          buyer_label: string | null
          created_at: string
          id: string
          payment_intent: string | null
          pipeline_item_id: string | null
          quoted_price: number | null
          raw_payload: Json | null
          reason: string | null
          required_threshold: number | null
          status: string
          updated_at: string
          webhook_id: string | null
        }
        Insert: {
          auction_window_id?: string | null
          bid_amount?: number
          buyer_label?: string | null
          created_at?: string
          id?: string
          payment_intent?: string | null
          pipeline_item_id?: string | null
          quoted_price?: number | null
          raw_payload?: Json | null
          reason?: string | null
          required_threshold?: number | null
          status?: string
          updated_at?: string
          webhook_id?: string | null
        }
        Update: {
          auction_window_id?: string | null
          bid_amount?: number
          buyer_label?: string | null
          created_at?: string
          id?: string
          payment_intent?: string | null
          pipeline_item_id?: string | null
          quoted_price?: number | null
          raw_payload?: Json | null
          reason?: string | null
          required_threshold?: number | null
          status?: string
          updated_at?: string
          webhook_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "m2m_bids_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m2m_bids_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m2m_bids_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m2m_bids_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m2m_bids_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m2m_bids_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "institutional_webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      m2m_discovery_targets: {
        Row: {
          active: boolean
          created_at: string
          domain: string
          id: string
          label: string | null
          last_scanned_at: string | null
          last_status: string | null
          notes: string | null
          schema_map: Json | null
          schema_url: string | null
          status: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          domain: string
          id?: string
          label?: string | null
          last_scanned_at?: string | null
          last_status?: string | null
          notes?: string | null
          schema_map?: Json | null
          schema_url?: string | null
          status?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          domain?: string
          id?: string
          label?: string | null
          last_scanned_at?: string | null
          last_status?: string | null
          notes?: string | null
          schema_map?: Json | null
          schema_url?: string | null
          status?: string
        }
        Relationships: []
      }
      m2m_executions: {
        Row: {
          amount_usd: number
          api_key_id: string | null
          buyer_reference: string | null
          created_at: string
          error_text: string | null
          id: string
          latency_ms: number | null
          pipeline_item_id: string | null
          signature_hash: string | null
          status: string
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
          tif_remaining_ms: number | null
          vdr_token: string | null
        }
        Insert: {
          amount_usd?: number
          api_key_id?: string | null
          buyer_reference?: string | null
          created_at?: string
          error_text?: string | null
          id?: string
          latency_ms?: number | null
          pipeline_item_id?: string | null
          signature_hash?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          tif_remaining_ms?: number | null
          vdr_token?: string | null
        }
        Update: {
          amount_usd?: number
          api_key_id?: string | null
          buyer_reference?: string | null
          created_at?: string
          error_text?: string | null
          id?: string
          latency_ms?: number | null
          pipeline_item_id?: string | null
          signature_hash?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          tif_remaining_ms?: number | null
          vdr_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "m2m_executions_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "institutional_api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m2m_executions_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m2m_executions_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m2m_executions_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m2m_executions_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m2m_executions_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      m2m_idempotency_receipts: {
        Row: {
          api_key_id: string | null
          client_txn_id: string
          created_at: string
          endpoint: string
          http_status: number
          id: string
          request_hash: string | null
          response: Json
        }
        Insert: {
          api_key_id?: string | null
          client_txn_id: string
          created_at?: string
          endpoint: string
          http_status: number
          id?: string
          request_hash?: string | null
          response?: Json
        }
        Update: {
          api_key_id?: string | null
          client_txn_id?: string
          created_at?: string
          endpoint?: string
          http_status?: number
          id?: string
          request_hash?: string | null
          response?: Json
        }
        Relationships: [
          {
            foreignKeyName: "m2m_idempotency_receipts_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "institutional_api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      m2m_inbound_log: {
        Row: {
          api_key_prefix: string | null
          authorized: boolean
          body_preview: string | null
          box_label: string | null
          endpoint: string
          headers: Json | null
          http_status: number | null
          id: string
          ip: string | null
          latency_ms: number | null
          method: string
          received_at: string
          user_agent: string | null
        }
        Insert: {
          api_key_prefix?: string | null
          authorized?: boolean
          body_preview?: string | null
          box_label?: string | null
          endpoint: string
          headers?: Json | null
          http_status?: number | null
          id?: string
          ip?: string | null
          latency_ms?: number | null
          method: string
          received_at?: string
          user_agent?: string | null
        }
        Update: {
          api_key_prefix?: string | null
          authorized?: boolean
          body_preview?: string | null
          box_label?: string | null
          endpoint?: string
          headers?: Json | null
          http_status?: number | null
          id?: string
          ip?: string | null
          latency_ms?: number | null
          method?: string
          received_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      m2m_node_health: {
        Row: {
          box_id: string
          consecutive_failures: number
          label: string | null
          last_attempt_at: string | null
          last_error: string | null
          last_latency_ms: number | null
          last_status: number | null
          last_success_at: string | null
          reachable: boolean
          total_accepts: number
          total_attempts: number
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          box_id: string
          consecutive_failures?: number
          label?: string | null
          last_attempt_at?: string | null
          last_error?: string | null
          last_latency_ms?: number | null
          last_status?: number | null
          last_success_at?: string | null
          reachable?: boolean
          total_accepts?: number
          total_attempts?: number
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          box_id?: string
          consecutive_failures?: number
          label?: string | null
          last_attempt_at?: string | null
          last_error?: string | null
          last_latency_ms?: number | null
          last_status?: number | null
          last_success_at?: string | null
          reachable?: boolean
          total_accepts?: number
          total_attempts?: number
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "m2m_node_health_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: true
            referencedRelation: "buyer_buy_boxes"
            referencedColumns: ["id"]
          },
        ]
      }
      maker_taker_profiles: {
        Row: {
          buyer_email: string | null
          buyer_id: string | null
          classification: string
          fee_modifier_bps: number
          id: string
          last_evaluated_at: string
          standing_capital_usd: number
          standing_since: string | null
        }
        Insert: {
          buyer_email?: string | null
          buyer_id?: string | null
          classification?: string
          fee_modifier_bps?: number
          id?: string
          last_evaluated_at?: string
          standing_capital_usd?: number
          standing_since?: string | null
        }
        Update: {
          buyer_email?: string | null
          buyer_id?: string | null
          classification?: string
          fee_modifier_bps?: number
          id?: string
          last_evaluated_at?: string
          standing_capital_usd?: number
          standing_since?: string | null
        }
        Relationships: []
      }
      market_telemetry: {
        Row: {
          asset_margin: number | null
          asset_price: number | null
          asset_type: string | null
          candidate_count: number
          created_at: string
          id: string
          nearest_buyer_id: string | null
          nearest_max_price: number | null
          nearest_required_margin: number | null
          pipeline_item_id: string | null
          price_delta: number | null
          rejection_reason: string | null
          yield_delta: number | null
          zip: string | null
        }
        Insert: {
          asset_margin?: number | null
          asset_price?: number | null
          asset_type?: string | null
          candidate_count?: number
          created_at?: string
          id?: string
          nearest_buyer_id?: string | null
          nearest_max_price?: number | null
          nearest_required_margin?: number | null
          pipeline_item_id?: string | null
          price_delta?: number | null
          rejection_reason?: string | null
          yield_delta?: number | null
          zip?: string | null
        }
        Update: {
          asset_margin?: number | null
          asset_price?: number | null
          asset_type?: string | null
          candidate_count?: number
          created_at?: string
          id?: string
          nearest_buyer_id?: string | null
          nearest_max_price?: number | null
          nearest_required_margin?: number | null
          pipeline_item_id?: string | null
          price_delta?: number | null
          rejection_reason?: string | null
          yield_delta?: number | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "market_telemetry_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_telemetry_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_telemetry_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_telemetry_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_telemetry_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_delivery_logs: {
        Row: {
          buyer_id: string | null
          contract_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          meta: Json
          pipeline_item_id: string | null
          provider_message_id: string | null
          reason_code:
            | Database["public"]["Enums"]["offer_rejection_code"]
            | null
          recipient_email: string | null
          status: Database["public"]["Enums"]["offer_delivery_status"]
          subject: string | null
          user_agent: string | null
        }
        Insert: {
          buyer_id?: string | null
          contract_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          meta?: Json
          pipeline_item_id?: string | null
          provider_message_id?: string | null
          reason_code?:
            | Database["public"]["Enums"]["offer_rejection_code"]
            | null
          recipient_email?: string | null
          status: Database["public"]["Enums"]["offer_delivery_status"]
          subject?: string | null
          user_agent?: string | null
        }
        Update: {
          buyer_id?: string | null
          contract_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          meta?: Json
          pipeline_item_id?: string | null
          provider_message_id?: string | null
          reason_code?:
            | Database["public"]["Enums"]["offer_rejection_code"]
            | null
          recipient_email?: string | null
          status?: Database["public"]["Enums"]["offer_delivery_status"]
          subject?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offer_delivery_logs_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_delivery_logs_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_delivery_logs_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_delivery_logs_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_delivery_logs_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_alert_log: {
        Row: {
          channel: string
          created_at: string
          error: string | null
          id: string
          payload: Json | null
          pipeline_item_id: string | null
          status: string
          target: string | null
          updated_at: string
        }
        Insert: {
          channel: string
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json | null
          pipeline_item_id?: string | null
          status?: string
          target?: string | null
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json | null
          pipeline_item_id?: string | null
          status?: string
          target?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_alert_log_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_alert_log_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_alert_log_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_alert_log_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_alert_log_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_dispatch_queue: {
        Row: {
          attempts: number
          channel: string
          created_at: string
          dedupe_key: string
          headers: Json
          html: string | null
          id: string
          last_error: string | null
          not_before: string
          pipeline_item_id: string | null
          sent_at: string | null
          status: string
          subject: string | null
          target: string
        }
        Insert: {
          attempts?: number
          channel?: string
          created_at?: string
          dedupe_key: string
          headers?: Json
          html?: string | null
          id?: string
          last_error?: string | null
          not_before?: string
          pipeline_item_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          target: string
        }
        Update: {
          attempts?: number
          channel?: string
          created_at?: string
          dedupe_key?: string
          headers?: Json
          html?: string | null
          id?: string
          last_error?: string | null
          not_before?: string
          pipeline_item_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          target?: string
        }
        Relationships: []
      }
      payout_recipient_profiles: {
        Row: {
          account_number: string | null
          account_type: string
          allocation_pct: number
          bank_name: string | null
          created_at: string
          display_name: string
          flat_amount_usd: number
          id: string
          is_active: boolean
          notes: string | null
          recipient_key: string
          routing_number: string | null
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          account_type?: string
          allocation_pct?: number
          bank_name?: string | null
          created_at?: string
          display_name: string
          flat_amount_usd?: number
          id?: string
          is_active?: boolean
          notes?: string | null
          recipient_key: string
          routing_number?: string | null
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          account_type?: string
          allocation_pct?: number
          bank_name?: string | null
          created_at?: string
          display_name?: string
          flat_amount_usd?: number
          id?: string
          is_active?: boolean
          notes?: string | null
          recipient_key?: string
          routing_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      penny_test_verifications: {
        Row: {
          amount_a_cents: number
          amount_b_cents: number
          created_at: string
          deal_id: string | null
          id: string
          idempotency_key: string
          lock_hash: string
          matched_at: string | null
          salt_date: string
          status: string
          stripe_reference: string | null
          updated_at: string
        }
        Insert: {
          amount_a_cents: number
          amount_b_cents: number
          created_at?: string
          deal_id?: string | null
          id?: string
          idempotency_key: string
          lock_hash: string
          matched_at?: string | null
          salt_date?: string
          status?: string
          stripe_reference?: string | null
          updated_at?: string
        }
        Update: {
          amount_a_cents?: number
          amount_b_cents?: number
          created_at?: string
          deal_id?: string | null
          id?: string
          idempotency_key?: string
          lock_hash?: string
          matched_at?: string | null
          salt_date?: string
          status?: string
          stripe_reference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "penny_test_verifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penny_test_verifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penny_test_verifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penny_test_verifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penny_test_verifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_status_history: {
        Row: {
          changed_at: string
          id: string
          new_escrow_status: string | null
          new_status: string
          old_escrow_status: string | null
          old_status: string | null
          pipeline_item_id: string
        }
        Insert: {
          changed_at?: string
          id?: string
          new_escrow_status?: string | null
          new_status: string
          old_escrow_status?: string | null
          old_status?: string | null
          pipeline_item_id: string
        }
        Update: {
          changed_at?: string
          id?: string
          new_escrow_status?: string | null
          new_status?: string
          old_escrow_status?: string | null
          old_status?: string | null
          pipeline_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_status_history_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_status_history_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_status_history_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_status_history_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_status_history_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_items: {
        Row: {
          access_token: string
          account_id: string | null
          account_mask: string | null
          account_name: string | null
          created_at: string
          id: string
          institution_id: string
          institution_name: string
          item_id: string
          linked_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          access_token: string
          account_id?: string | null
          account_mask?: string | null
          account_name?: string | null
          created_at?: string
          id?: string
          institution_id?: string
          institution_name?: string
          item_id: string
          linked_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          account_id?: string | null
          account_mask?: string | null
          account_name?: string | null
          created_at?: string
          id?: string
          institution_id?: string
          institution_name?: string
          item_id?: string
          linked_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      plaid_transfers: {
        Row: {
          amount_usd: number
          authorization_id: string | null
          created_at: string
          deal_id: string | null
          direction: string
          failure_reason: string | null
          id: string
          idempotency_key: string | null
          status: string
          transfer_id: string | null
          updated_at: string
        }
        Insert: {
          amount_usd: number
          authorization_id?: string | null
          created_at?: string
          deal_id?: string | null
          direction: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          status?: string
          transfer_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_usd?: number
          authorization_id?: string | null
          created_at?: string
          deal_id?: string | null
          direction?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          status?: string
          transfer_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      poison_pill_riders: {
        Row: {
          buyer_email: string | null
          buyer_entity: string | null
          confession_of_judgment: boolean
          created_at: string
          cross_collateral_scope: string
          id: string
          liquidated_damages_usd: number
          pipeline_item_id: string | null
          trigger_reason: string | null
          triggered_at: string | null
        }
        Insert: {
          buyer_email?: string | null
          buyer_entity?: string | null
          confession_of_judgment?: boolean
          created_at?: string
          cross_collateral_scope?: string
          id?: string
          liquidated_damages_usd?: number
          pipeline_item_id?: string | null
          trigger_reason?: string | null
          triggered_at?: string | null
        }
        Update: {
          buyer_email?: string | null
          buyer_entity?: string | null
          confession_of_judgment?: boolean
          created_at?: string
          cross_collateral_scope?: string
          id?: string
          liquidated_damages_usd?: number
          pipeline_item_id?: string | null
          trigger_reason?: string | null
          triggered_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "poison_pill_riders_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poison_pill_riders_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poison_pill_riders_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poison_pill_riders_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poison_pill_riders_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      pre_distress_signals: {
        Row: {
          apn: string | null
          created_at: string
          id: string
          level: string
          outreach_dispatched_at: string | null
          pipeline_item_id: string | null
          score: number
          staged_capital_usd: number
          vectors: Json
          zip: string | null
        }
        Insert: {
          apn?: string | null
          created_at?: string
          id?: string
          level?: string
          outreach_dispatched_at?: string | null
          pipeline_item_id?: string | null
          score?: number
          staged_capital_usd?: number
          vectors?: Json
          zip?: string | null
        }
        Update: {
          apn?: string | null
          created_at?: string
          id?: string
          level?: string
          outreach_dispatched_at?: string | null
          pipeline_item_id?: string | null
          score?: number
          staged_capital_usd?: number
          vectors?: Json
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pre_distress_signals_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_distress_signals_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_distress_signals_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_distress_signals_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_distress_signals_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      processed_commands: {
        Row: {
          command_type: string
          created_at: string
          deal_id: string | null
          execution_key: string
          id: string
          payload_hash: string | null
          result: Json | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          command_type?: string
          created_at?: string
          deal_id?: string | null
          execution_key: string
          id?: string
          payload_hash?: string | null
          result?: Json | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          command_type?: string
          created_at?: string
          deal_id?: string | null
          execution_key?: string
          id?: string
          payload_hash?: string | null
          result?: Json | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      processed_ledger_events: {
        Row: {
          processed_at: string
          stripe_event_id: string
        }
        Insert: {
          processed_at?: string
          stripe_event_id: string
        }
        Update: {
          processed_at?: string
          stripe_event_id?: string
        }
        Relationships: []
      }
      resilient_outbox: {
        Row: {
          abandoned_at: string | null
          attempts: number
          created_at: string
          delivered_at: string | null
          headers: Json
          id: string
          kind: string
          last_error: string | null
          last_status: number | null
          max_attempts: number
          method: string
          next_attempt_at: string
          payload: Json
          pipeline_item_id: string | null
          target_url: string
          updated_at: string
        }
        Insert: {
          abandoned_at?: string | null
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          headers?: Json
          id?: string
          kind?: string
          last_error?: string | null
          last_status?: number | null
          max_attempts?: number
          method?: string
          next_attempt_at?: string
          payload?: Json
          pipeline_item_id?: string | null
          target_url: string
          updated_at?: string
        }
        Update: {
          abandoned_at?: string | null
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          headers?: Json
          id?: string
          kind?: string
          last_error?: string | null
          last_status?: number | null
          max_attempts?: number
          method?: string
          next_attempt_at?: string
          payload?: Json
          pipeline_item_id?: string | null
          target_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      retail_locations: {
        Row: {
          address: string | null
          base_annual_cost: number | null
          boundary: Json | null
          city: string | null
          created_at: string
          evaluated_at: string | null
          evaluation_note: string | null
          external_id: string | null
          geom: unknown
          id: string
          is_active: boolean
          kind: string
          name: string
          projected_10yr_cost: number | null
          source: string | null
          state: string | null
          status: string
          updated_at: string
          zip: string | null
        }
        Insert: {
          address?: string | null
          base_annual_cost?: number | null
          boundary?: Json | null
          city?: string | null
          created_at?: string
          evaluated_at?: string | null
          evaluation_note?: string | null
          external_id?: string | null
          geom: unknown
          id?: string
          is_active?: boolean
          kind?: string
          name: string
          projected_10yr_cost?: number | null
          source?: string | null
          state?: string | null
          status?: string
          updated_at?: string
          zip?: string | null
        }
        Update: {
          address?: string | null
          base_annual_cost?: number | null
          boundary?: Json | null
          city?: string | null
          created_at?: string
          evaluated_at?: string | null
          evaluation_note?: string | null
          external_id?: string | null
          geom?: unknown
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          projected_10yr_cost?: number | null
          source?: string | null
          state?: string | null
          status?: string
          updated_at?: string
          zip?: string | null
        }
        Relationships: []
      }
      reverse_strike_queue: {
        Row: {
          counter_offer: number | null
          created_at: string
          dispatch_attempts: number
          dispatched_at: string | null
          floor_price: number | null
          id: string
          last_attempt_at: string | null
          last_error: string | null
          last_response: Json | null
          original_price: number | null
          payload: Json
          pipeline_item_id: string
          seller_routing_json: Json | null
          status: string
          updated_at: string
          zip: string | null
        }
        Insert: {
          counter_offer?: number | null
          created_at?: string
          dispatch_attempts?: number
          dispatched_at?: string | null
          floor_price?: number | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          last_response?: Json | null
          original_price?: number | null
          payload: Json
          pipeline_item_id: string
          seller_routing_json?: Json | null
          status?: string
          updated_at?: string
          zip?: string | null
        }
        Update: {
          counter_offer?: number | null
          created_at?: string
          dispatch_attempts?: number
          dispatched_at?: string | null
          floor_price?: number | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          last_response?: Json | null
          original_price?: number | null
          payload?: Json
          pipeline_item_id?: string
          seller_routing_json?: Json | null
          status?: string
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reverse_strike_queue_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reverse_strike_queue_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reverse_strike_queue_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reverse_strike_queue_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reverse_strike_queue_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      routing_dispatch_log: {
        Row: {
          dispatched_at: string
          endpoint_id: string
          error_text: string | null
          http_status: number | null
          id: string
          latency_ms: number | null
          pipeline_item_id: string
          success: boolean
        }
        Insert: {
          dispatched_at?: string
          endpoint_id: string
          error_text?: string | null
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          pipeline_item_id: string
          success?: boolean
        }
        Update: {
          dispatched_at?: string
          endpoint_id?: string
          error_text?: string | null
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          pipeline_item_id?: string
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "routing_dispatch_log_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "routing_endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_dispatch_log_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_dispatch_log_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_dispatch_log_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_dispatch_log_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_dispatch_log_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      routing_endpoints: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          last_dispatched_at: string | null
          name: string
          priority_score: number
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_dispatched_at?: string | null
          name: string
          priority_score?: number
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_dispatched_at?: string | null
          name?: string
          priority_score?: number
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      shadow_escrow_ledger: {
        Row: {
          amount_released: number
          amount_secured: number
          created_at: string
          drips_completed: number
          drips_total: number
          id: string
          last_dispatch_at: string | null
          last_dispatch_response: Json | null
          liquidity_state: string
          next_drip_at: string
          pipeline_item_id: string
          total_assignment_fee: number
          updated_at: string
          user_id: string
          velocity_days: number
        }
        Insert: {
          amount_released?: number
          amount_secured?: number
          created_at?: string
          drips_completed?: number
          drips_total?: number
          id?: string
          last_dispatch_at?: string | null
          last_dispatch_response?: Json | null
          liquidity_state?: string
          next_drip_at?: string
          pipeline_item_id: string
          total_assignment_fee?: number
          updated_at?: string
          user_id: string
          velocity_days?: number
        }
        Update: {
          amount_released?: number
          amount_secured?: number
          created_at?: string
          drips_completed?: number
          drips_total?: number
          id?: string
          last_dispatch_at?: string | null
          last_dispatch_response?: Json | null
          liquidity_state?: string
          next_drip_at?: string
          pipeline_item_id?: string
          total_assignment_fee?: number
          updated_at?: string
          user_id?: string
          velocity_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "shadow_escrow_ledger_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shadow_escrow_ledger_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shadow_escrow_ledger_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shadow_escrow_ledger_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shadow_escrow_ledger_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      shadow_liquidity_queue: {
        Row: {
          allocated_capital_usd: number
          buyer_id: string
          created_at: string
          id: string
          is_active: boolean
          label: string | null
          last_matched_at: string | null
          max_purchase_price: number
          required_margin_percentage: number
          target_asset_types: string[]
          target_zip_codes: string[]
          updated_at: string
          webhook_target_url: string
        }
        Insert: {
          allocated_capital_usd?: number
          buyer_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          last_matched_at?: string | null
          max_purchase_price: number
          required_margin_percentage?: number
          target_asset_types?: string[]
          target_zip_codes?: string[]
          updated_at?: string
          webhook_target_url: string
        }
        Update: {
          allocated_capital_usd?: number
          buyer_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          last_matched_at?: string | null
          max_purchase_price?: number
          required_margin_percentage?: number
          target_asset_types?: string[]
          target_zip_codes?: string[]
          updated_at?: string
          webhook_target_url?: string
        }
        Relationships: []
      }
      sovereign_reservations: {
        Row: {
          buyer_ref: string
          created_at: string
          deal_id: string
          fee_ack_hash: string | null
          id: string
          mode: string
          reserved_capital_usd: number | null
          stamp_micros: number
          state: string
          updated_at: string
        }
        Insert: {
          buyer_ref: string
          created_at?: string
          deal_id: string
          fee_ack_hash?: string | null
          id?: string
          mode?: string
          reserved_capital_usd?: number | null
          stamp_micros: number
          state?: string
          updated_at?: string
        }
        Update: {
          buyer_ref?: string
          created_at?: string
          deal_id?: string
          fee_ack_hash?: string | null
          id?: string
          mode?: string
          reserved_capital_usd?: number | null
          stamp_micros?: number
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sovereign_reservations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sovereign_reservations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sovereign_reservations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sovereign_reservations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sovereign_reservations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      spv_wrappers: {
        Row: {
          created_at: string
          ein_status: string
          entity_name: string
          formation_status: string
          id: string
          jurisdiction: string
          mita_buyer_id: string | null
          mita_executed_at: string | null
          pipeline_item_id: string | null
          registered_agent: string | null
        }
        Insert: {
          created_at?: string
          ein_status?: string
          entity_name: string
          formation_status?: string
          id?: string
          jurisdiction?: string
          mita_buyer_id?: string | null
          mita_executed_at?: string | null
          pipeline_item_id?: string | null
          registered_agent?: string | null
        }
        Update: {
          created_at?: string
          ein_status?: string
          entity_name?: string
          formation_status?: string
          id?: string
          jurisdiction?: string
          mita_buyer_id?: string | null
          mita_executed_at?: string | null
          pipeline_item_id?: string | null
          registered_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spv_wrappers_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spv_wrappers_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spv_wrappers_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spv_wrappers_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spv_wrappers_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      submarket_weights: {
        Row: {
          accepts: number
          fund_id: string | null
          id: string
          rejects: number
          updated_at: string
          weight: number
          zip: string
        }
        Insert: {
          accepts?: number
          fund_id?: string | null
          id?: string
          rejects?: number
          updated_at?: string
          weight?: number
          zip: string
        }
        Update: {
          accepts?: number
          fund_id?: string | null
          id?: string
          rejects?: number
          updated_at?: string
          weight?: number
          zip?: string
        }
        Relationships: []
      }
      system_alerts: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          deal_id: string | null
          id: string
          kind: string
          message: string
          metadata: Json
          severity: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          kind: string
          message: string
          metadata?: Json
          severity?: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          kind?: string
          message?: string
          metadata?: Json
          severity?: string
        }
        Relationships: []
      }
      system_audit_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          new_data: Json | null
          old_data: Json | null
          operation: string
          row_id: string | null
          table_name: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          operation: string
          row_id?: string | null
          table_name: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          operation?: string
          row_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      system_audit_logs: {
        Row: {
          created_at: string
          event_type: string | null
          from_status: string | null
          id: string
          ip_address: string | null
          llm_confidence_score: number | null
          payload: Json | null
          pipeline_item_id: string | null
          reason: string
          to_status: string | null
        }
        Insert: {
          created_at?: string
          event_type?: string | null
          from_status?: string | null
          id?: string
          ip_address?: string | null
          llm_confidence_score?: number | null
          payload?: Json | null
          pipeline_item_id?: string | null
          reason: string
          to_status?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string | null
          from_status?: string | null
          id?: string
          ip_address?: string | null
          llm_confidence_score?: number | null
          payload?: Json | null
          pipeline_item_id?: string | null
          reason?: string
          to_status?: string | null
        }
        Relationships: []
      }
      system_config: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      system_diagnostic_log: {
        Row: {
          active_owner: string
          created_at: string
          fee: number | null
          id: string
          metadata: Json | null
          partner_share: number | null
          pipeline_item_id: string | null
          rule: string
        }
        Insert: {
          active_owner: string
          created_at?: string
          fee?: number | null
          id?: string
          metadata?: Json | null
          partner_share?: number | null
          pipeline_item_id?: string | null
          rule: string
        }
        Update: {
          active_owner?: string
          created_at?: string
          fee?: number | null
          id?: string
          metadata?: Json | null
          partner_share?: number | null
          pipeline_item_id?: string | null
          rule?: string
        }
        Relationships: []
      }
      system_error_logs: {
        Row: {
          alerted: boolean
          context: Json
          created_at: string
          id: string
          message: string
          route: string
          severity: string
          stack: string | null
        }
        Insert: {
          alerted?: boolean
          context?: Json
          created_at?: string
          id?: string
          message: string
          route: string
          severity?: string
          stack?: string | null
        }
        Update: {
          alerted?: boolean
          context?: Json
          created_at?: string
          id?: string
          message?: string
          route?: string
          severity?: string
          stack?: string | null
        }
        Relationships: []
      }
      system_flags: {
        Row: {
          bool_value: boolean | null
          int_value: number | null
          key: string
          text_value: string | null
          updated_at: string
        }
        Insert: {
          bool_value?: boolean | null
          int_value?: number | null
          key: string
          text_value?: string | null
          updated_at?: string
        }
        Update: {
          bool_value?: boolean | null
          int_value?: number | null
          key?: string
          text_value?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      system_metrics: {
        Row: {
          computed_at: string
          metric_count: number
          metric_name: string
          metric_value: number
        }
        Insert: {
          computed_at?: string
          metric_count?: number
          metric_name: string
          metric_value?: number
        }
        Update: {
          computed_at?: string
          metric_count?: number
          metric_name?: string
          metric_value?: number
        }
        Relationships: []
      }
      system_state: {
        Row: {
          accept_inbound_liquidity: boolean
          created_at: string
          id: boolean
          updated_at: string
        }
        Insert: {
          accept_inbound_liquidity?: boolean
          created_at?: string
          id?: boolean
          updated_at?: string
        }
        Update: {
          accept_inbound_liquidity?: boolean
          created_at?: string
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      title_cloud_recordings: {
        Row: {
          apn: string | null
          attempts: number
          county: string | null
          created_at: string
          document_hash: string
          document_text: string
          document_type: string
          id: string
          last_error: string | null
          notary_ref: string | null
          notary_status: string
          pipeline_item_id: string
          recorded_at: string | null
          recording_ref: string | null
          recording_status: string
          released_at: string | null
          updated_at: string
        }
        Insert: {
          apn?: string | null
          attempts?: number
          county?: string | null
          created_at?: string
          document_hash: string
          document_text: string
          document_type?: string
          id?: string
          last_error?: string | null
          notary_ref?: string | null
          notary_status?: string
          pipeline_item_id: string
          recorded_at?: string | null
          recording_ref?: string | null
          recording_status?: string
          released_at?: string | null
          updated_at?: string
        }
        Update: {
          apn?: string | null
          attempts?: number
          county?: string | null
          created_at?: string
          document_hash?: string
          document_text?: string
          document_type?: string
          id?: string
          last_error?: string | null
          notary_ref?: string | null
          notary_status?: string
          pipeline_item_id?: string
          recorded_at?: string | null
          recording_ref?: string | null
          recording_status?: string
          released_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "title_cloud_recordings_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "title_cloud_recordings_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "title_cloud_recordings_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "title_cloud_recordings_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "title_cloud_recordings_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      title_packages: {
        Row: {
          created_at: string
          id: string
          package_status: Database["public"]["Enums"]["title_package_status"]
          payload: Json
          pipeline_item_id: string
          title_company_ref: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          package_status?: Database["public"]["Enums"]["title_package_status"]
          payload?: Json
          pipeline_item_id: string
          title_company_ref?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          package_status?: Database["public"]["Enums"]["title_package_status"]
          payload?: Json
          pipeline_item_id?: string
          title_company_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "title_packages_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "title_packages_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "title_packages_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "title_packages_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "title_packages_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: true
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      ttl_micro_auctions: {
        Row: {
          buy_box_id: string | null
          buyer_id: string | null
          created_at: string
          expires_at: string
          id: string
          offer_price: number
          pipeline_item_id: string | null
          ratchet_usd: number
          status: string
          tier: number
          ttl_seconds: number
        }
        Insert: {
          buy_box_id?: string | null
          buyer_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          offer_price: number
          pipeline_item_id?: string | null
          ratchet_usd?: number
          status?: string
          tier?: number
          ttl_seconds?: number
        }
        Update: {
          buy_box_id?: string | null
          buyer_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          offer_price?: number
          pipeline_item_id?: string | null
          ratchet_usd?: number
          status?: string
          tier?: number
          ttl_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "ttl_micro_auctions_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "closing_pipeline_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ttl_micro_auctions_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "deal_allocations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ttl_micro_auctions_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "partner_pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ttl_micro_auctions_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "tier1_dark_pool_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ttl_micro_auctions_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "view_pipeline_health"
            referencedColumns: ["id"]
          },
        ]
      }
      uat_micro_settlements: {
        Row: {
          amount_usd: number
          api_key_id: string | null
          client_txn_id: string | null
          created_at: string
          error_text: string | null
          handshake_status: number | null
          id: string
          latency_ms: number | null
          pipeline_item_id: string | null
          rail_reference: string | null
          rail_status: string | null
          signature_ok: boolean
        }
        Insert: {
          amount_usd?: number
          api_key_id?: string | null
          client_txn_id?: string | null
          created_at?: string
          error_text?: string | null
          handshake_status?: number | null
          id?: string
          latency_ms?: number | null
          pipeline_item_id?: string | null
          rail_reference?: string | null
          rail_status?: string | null
          signature_ok?: boolean
        }
        Update: {
          amount_usd?: number
          api_key_id?: string | null
          client_txn_id?: string | null
          created_at?: string
          error_text?: string | null
          handshake_status?: number | null
          id?: string
          latency_ms?: number | null
          pipeline_item_id?: string | null
          rail_reference?: string | null
          rail_status?: string | null
          signature_ok?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "uat_micro_settlements_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "institutional_api_keys"
            referencedColumns: ["id"]
          },
        ]
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
      webhook_replay_guard: {
        Row: {
          event_id: string
          seen_at: string
          source: string
        }
        Insert: {
          event_id: string
          seen_at?: string
          source: string
        }
        Update: {
          event_id?: string
          seen_at?: string
          source?: string
        }
        Relationships: []
      }
    }
    Views: {
      deal_allocations_view: {
        Row: {
          acreage: number | null
          address_raw: string | null
          asset_class: string | null
          assignment_fee: number | null
          contract_price: number | null
          created_at: string | null
          id: string | null
          is_odd_parcel: boolean | null
          jaquita_share: number | null
          jasmine_share: number | null
          owner_share: number | null
          parcel_number: string | null
          primary_beneficiary: string | null
          state: string | null
          status: string | null
          zip: string | null
        }
        Relationships: []
      }
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
      partner_pipeline_view: {
        Row: {
          active_owner: string | null
          id: string | null
          optimized_acquisition_premium: number | null
          parity_proxy: number | null
          property_address: string | null
          routing_rule: string | null
          status: Database["public"]["Enums"]["app_pipeline_status"] | null
          updated_at: string | null
        }
        Insert: {
          active_owner?: string | null
          id?: string | null
          optimized_acquisition_premium?: number | null
          parity_proxy?: number | null
          property_address?: never
          routing_rule?: string | null
          status?: Database["public"]["Enums"]["app_pipeline_status"] | null
          updated_at?: string | null
        }
        Update: {
          active_owner?: string | null
          id?: string | null
          optimized_acquisition_premium?: number | null
          parity_proxy?: number | null
          property_address?: never
          routing_rule?: string | null
          status?: Database["public"]["Enums"]["app_pipeline_status"] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      qre_institutional_deal_tape: {
        Row: {
          address: string | null
          arv_projection: number | null
          asset_id: string | null
          cost_basis: number | null
          feed_generated_at: string | null
          market: string | null
          micro_market: string | null
          portfolio_id: string | null
          state_module: string | null
          status: string | null
        }
        Relationships: []
      }
      tier1_dark_pool_view: {
        Row: {
          active_owner: string | null
          base_contract_price: number | null
          confidence_score: number | null
          created_at: string | null
          fee: number | null
          id: string | null
          liquidity_tier: string | null
          manual_review: boolean | null
          property_address: string | null
          routing_rule: string | null
          status: Database["public"]["Enums"]["app_pipeline_status"] | null
          title_status: Database["public"]["Enums"]["title_status_enum"] | null
          updated_at: string | null
          zip: string | null
        }
        Insert: {
          active_owner?: string | null
          base_contract_price?: number | null
          confidence_score?: number | null
          created_at?: string | null
          fee?: number | null
          id?: string | null
          liquidity_tier?: string | null
          manual_review?: boolean | null
          property_address?: never
          routing_rule?: string | null
          status?: Database["public"]["Enums"]["app_pipeline_status"] | null
          title_status?: Database["public"]["Enums"]["title_status_enum"] | null
          updated_at?: string | null
          zip?: string | null
        }
        Update: {
          active_owner?: string | null
          base_contract_price?: number | null
          confidence_score?: number | null
          created_at?: string | null
          fee?: number | null
          id?: string | null
          liquidity_tier?: string | null
          manual_review?: boolean | null
          property_address?: never
          routing_rule?: string | null
          status?: Database["public"]["Enums"]["app_pipeline_status"] | null
          title_status?: Database["public"]["Enums"]["title_status_enum"] | null
          updated_at?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      view_pipeline_health: {
        Row: {
          address: string | null
          base_contract_price: number | null
          cleared_amount: number | null
          cleared_at: string | null
          days_in_current_status: number | null
          escrow_status: string | null
          id: string | null
          locked_at: string | null
          optimized_acquisition_premium: number | null
          risk_flag: string | null
          status: string | null
          status_since: string | null
          updated_at: string | null
          zip: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      algorithmic_price_adjustment: {
        Args: never
        Returns: {
          action: string
          deal_id: string
          new_price: number
          old_price: number
        }[]
      }
      assemblage_radar_snapshot: { Args: never; Returns: Json }
      assemble_contract_payload: {
        Args: { _box_id?: string; _id: string }
        Returns: Json
      }
      auto_bundle_orphaned_assets: {
        Args: {
          _max_bundles_per_run?: number
          _min_age_hours?: number
          _min_group_size?: number
        }
        Returns: {
          blended_yield: number
          bundle_id: string
          deal_count: number
          total_base: number
          zip: string
        }[]
      }
      auto_clear_eligible_deals: {
        Args: never
        Returns: {
          action: string
          cleared_amount: number
          deal_id: string
          zip: string
        }[]
      }
      auto_evict_stale_allocations: { Args: never; Returns: number }
      autopilot_watchdog_sweep: { Args: never; Returns: number }
      buyer_density: { Args: { _zip: string }; Returns: number }
      calculate_pipeline_fee: {
        Args: { p_total_amount: number }
        Returns: number
      }
      claim_command: {
        Args: {
          _command_type?: string
          _deal_id?: string
          _execution_key: string
          _payload_hash?: string
          _source?: string
        }
        Returns: {
          claimed: boolean
          command_id: string
          first_seen_at: string
          prior_status: string
        }[]
      }
      claim_dispatch_slot: {
        Args: {
          _buyer_id: string
          _cooldown_hours?: number
          _hourly_cap?: number
          _property_id: string
          _recipient_email: string
        }
        Returns: {
          allowed: boolean
          reason: string
        }[]
      }
      clear_funds_idempotent: {
        Args: {
          _cleared_amount: number
          _deal_id: string
          _stripe_event_id: string
        }
        Returns: {
          cleared_at: string
          deal_id: string
          was_already_cleared: boolean
        }[]
      }
      cleared_today_usd: { Args: never; Returns: number }
      commercial_assemblage_radar: { Args: never; Returns: Json }
      competitive_inventory_scan: {
        Args: never
        Returns: {
          active_inventory: number
          bumped_buy_boxes: number
          zip: string
        }[]
      }
      complete_command: {
        Args: { _execution_key: string; _result?: Json; _status: string }
        Returns: undefined
      }
      compute_assignment_fee:
        | { Args: { _arv: number; _price: number }; Returns: number }
        | {
            Args: { p_arv: number; p_offer: number; p_repairs: number }
            Returns: number
          }
      compute_buyer_urgency: {
        Args: {
          _capital: number
          _persona: Database["public"]["Enums"]["buyer_persona"]
          _window_expiration: string
        }
        Returns: number
      }
      compute_confidence_score: {
        Args: { _price: number; _zip: string }
        Returns: number
      }
      compute_dynamic_spread: {
        Args: { _arv: number; _price: number; _zip: string }
        Returns: number
      }
      compute_emd_amount: {
        Args: { _price: number; _tags: string[] }
        Returns: {
          emd_amount: number
          emd_tier: string
        }[]
      }
      compute_liquidity_match: {
        Args: {
          _item: Database["public"]["Tables"]["closing_pipeline_items"]["Row"]
        }
        Returns: {
          bucket: string
          buy_box_id: string
          buyer_id: string
          score: number
        }[]
      }
      cvi_metrics: { Args: never; Returns: Json }
      decay_stale_assignment_fees: {
        Args: { _max_rows?: number }
        Returns: {
          deal_id: string
          decay_count: number
          new_fee: number
          old_fee: number
        }[]
      }
      deprecate_stale_buy_boxes: { Args: never; Returns: number }
      detect_assemblage_groups: {
        Args: never
        Returns: {
          combined_sqft: number
          deal_count: number
          group_id: string
          owner_entity: string
          zip: string
        }[]
      }
      disablelongtransactions: { Args: never; Returns: string }
      drip_shadow_escrow: {
        Args: never
        Returns: {
          ledger_id: string
          released_total: number
          state: string
          tranche: number
        }[]
      }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      eod_settlement_summary: { Args: { _hours?: number }; Returns: Json }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      execute_autonomous_settlements: { Args: never; Returns: number }
      execute_buyer_contract: {
        Args: {
          _buyer_email: string
          _id: string
          _ip?: string
          _signer_name: string
        }
        Returns: Json
      }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      get_current_partner_role: { Args: never; Returns: string }
      gettransactionid: { Args: never; Returns: unknown }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      inbound_liquidity_open: { Args: never; Returns: boolean }
      longtransactionsenabled: { Args: never; Returns: boolean }
      m2m_accept: {
        Args: { _box_id: string; _id: string; _signature?: string }
        Returns: Json
      }
      m2m_claim_dispatch: {
        Args: { _box_id: string; _id: string; _window_seconds?: number }
        Returns: Json
      }
      m2m_claim_micro: {
        Args: { _box_id: string; _id: string; _lock_ms: number }
        Returns: Json
      }
      mark_wire_in_flight: {
        Args: { _deal_id: string }
        Returns: {
          deal_id: string
          lock_phase: string
          m2m_expires_at: string
          wire_instructed_at: string
        }[]
      }
      market_telemetry_summary: { Args: { _days?: number }; Returns: Json }
      mission_control_pulse: { Args: never; Returns: Json }
      observer_sweep_stale: {
        Args: never
        Returns: {
          busted_locks: number
          marked_stale: number
        }[]
      }
      offer_deal_tif: {
        Args: { _box_id: string; _id: string }
        Returns: undefined
      }
      offer_telemetry_summary: { Args: never; Returns: Json }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      preflight_validate_lead: { Args: { _id: string }; Returns: Json }
      process_tif_expirations: {
        Args: never
        Returns: {
          action: string
          deal_id: string
          next_buy_box: string
        }[]
      }
      promote_scout_deals: {
        Args: never
        Returns: {
          action: string
          deal_id: string
          new_score: number
          old_score: number
        }[]
      }
      realworld_gate_status: { Args: { _id: string }; Returns: string }
      recalc_bundle_totals: { Args: { _bundle_id: string }; Returns: undefined }
      record_buyer_event: {
        Args: { _email: string; _event: string }
        Returns: {
          buyer_email: string
          clicks: number
          created_at: string
          deals_claimed: number
          deals_funded: number
          emd_timeouts: number
          id: string
          last_activity_at: string
          last_click_at: string | null
          last_event: string | null
          pof_failures: number
          reliability_score: number
          reservation_expirations: number
          tier: string
          updated_at: string
          velocity_score: number
        }
        SetofOptions: {
          from: "*"
          to: "buyer_scorecards"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_endpoint_fill: {
        Args: { _deal_id: string; _latency_ms: number }
        Returns: undefined
      }
      refresh_system_metrics: { Args: never; Returns: undefined }
      reject_offer: {
        Args: {
          _code: Database["public"]["Enums"]["offer_rejection_code"]
          _id: string
          _ip?: string
          _note?: string
          _source?: string
          _target_price?: number
          _user_agent?: string
        }
        Returns: Json
      }
      resuscitate_pipeline_item: { Args: { p_id: string }; Returns: Json }
      resuscitate_stagnant_deals: {
        Args: { _max_rows?: number }
        Returns: {
          deal_id: string
          new_fee: number
          old_fee: number
        }[]
      }
      retail_location_coords: {
        Args: { _id: string }
        Returns: {
          lat: number
          lon: number
        }[]
      }
      retail_stores_within_radius: {
        Args: { _lat: number; _lon: number; _radius_miles?: number }
        Returns: {
          address: string
          city: string
          distance_miles: number
          id: string
          kind: string
          lat: number
          lon: number
          name: string
          state: string
          zip: string
        }[]
      }
      retail_supplier_proximity_count: {
        Args: { _id: string; _radius_miles?: number }
        Returns: number
      }
      scan_ledger_anomalies: {
        Args: never
        Returns: {
          out_code: string
          out_detected: number
        }[]
      }
      self_heal_pipeline: {
        Args: never
        Returns: {
          action_taken: string
          items_repaired: number
        }[]
      }
      sovereign_claim: {
        Args: {
          _buyer_ref: string
          _capital?: number
          _deal_id: string
          _fee_ack_hash?: string
          _mode?: string
          _stamp_micros: number
        }
        Returns: Json
      }
      sovereign_signature_unblock: {
        Args: { _deal_id: string; _hash: string }
        Returns: Json
      }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      start_deal_reservation: {
        Args: { _buyer_email?: string; _id: string }
        Returns: Json
      }
      strike_lock_deal: {
        Args: { _deal_id: string; _key_id: string }
        Returns: {
          base_contract_price: number
          id: string
          lock_expires_at: string
          locked_at: string
          optimized_acquisition_premium: number
          status: string
          was_already_locked: boolean
          zip: string
        }[]
      }
      sweep_exception_queue: {
        Args: { _max_retries?: number }
        Returns: {
          action: string
          new_score: number
          pipeline_item_id: string
        }[]
      }
      sweep_expired_m2m: {
        Args: never
        Returns: {
          action: string
          box_id: string
          deal_id: string
        }[]
      }
      sweep_expired_reservations: {
        Args: never
        Returns: {
          action: string
          buyer_email: string
          deal_id: string
        }[]
      }
      sweep_expired_tif: {
        Args: never
        Returns: {
          deal_id: string
          prior_status: string
        }[]
      }
      sweep_micro_tif: {
        Args: never
        Returns: {
          box_id: string
          deal_id: string
          overdue_ms: number
        }[]
      }
      sweep_offer_ratchet: {
        Args: never
        Returns: {
          action: string
          deal_id: string
        }[]
      }
      sweep_stale_buyer_waitlist: { Args: never; Returns: number }
      sweep_ttl_auctions: {
        Args: { _max?: number }
        Returns: {
          action: string
          auction_id: string
          deal_id: string
          new_price: number
        }[]
      }
      tax_mitigation_multiplier: {
        Args: { _p: Database["public"]["Enums"]["buyer_persona"] }
        Returns: number
      }
      telemetry_heartbeat: { Args: never; Returns: undefined }
      tif_sweep_expired_locks: {
        Args: never
        Returns: {
          deal_id: string
          endpoint_id: string
        }[]
      }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
    }
    Enums: {
      app_pipeline_status:
        | "New"
        | "Under-Review"
        | "Seller-Signed"
        | "Buyer-Signed"
        | "In-Escrow"
        | "CRITICAL_STALL"
        | "Closed"
        | "Dead"
        | "Locked-Escrow-Pending"
        | "Funds-Cleared"
        | "Queued-For-Tomorrow"
        | "System-Hold"
        | "Scout"
        | "Rejected"
        | "House-Bid"
        | "Webhook_Dispatched"
        | "Shadow_Inventory"
        | "Auto-Enrichment-Pending"
        | "Auto_Archived_Bad_Data"
        | "Shadow_Matched"
        | "Pending-Underwriting"
        | "Funds-Suspended"
      app_role: "admin" | "moderator" | "user" | "viewer"
      buyer_persona:
        | "EXCHANGE_1031"
        | "CONVERSION_1033"
        | "QOZ_FUND"
        | "BONUS_DEPRECIATION"
        | "SDIRA_CASH"
        | "TIMO_SAWMILL"
        | "DRY_POWDER"
        | "HARD_MONEY_RECYCLER"
        | "ADJACENT_OWNER"
        | "BTR_INFILL"
        | "GENERIC"
      cre_asset_class:
        | "MULTIFAMILY_5PLUS"
        | "LIGHT_INDUSTRIAL"
        | "NNN_RETAIL"
        | "FLEX_STORAGE"
        | "COMMERCIAL_LAND"
        | "NON_COMMERCIAL"
      offer_delivery_status:
        | "DISPATCHED"
        | "DELIVERED"
        | "OPENED"
        | "CLICKED"
        | "REJECTED"
        | "EXECUTED"
      offer_rejection_code:
        | "YIELD_BELOW_HURDLE"
        | "LIEN_THRESHOLD_EXCEEDED"
        | "GEO_OUT_OF_BOUNDS"
        | "EMD_RAIL_MISMATCH"
        | "CAPITAL_SATURATED"
        | "CUSTOM_OTHER"
      title_package_status:
        | "Queued"
        | "Built"
        | "Sent"
        | "Acknowledged"
        | "Failed"
      title_status_enum: "Insured" | "Uninsurable" | "Pending"
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_pipeline_status: [
        "New",
        "Under-Review",
        "Seller-Signed",
        "Buyer-Signed",
        "In-Escrow",
        "CRITICAL_STALL",
        "Closed",
        "Dead",
        "Locked-Escrow-Pending",
        "Funds-Cleared",
        "Queued-For-Tomorrow",
        "System-Hold",
        "Scout",
        "Rejected",
        "House-Bid",
        "Webhook_Dispatched",
        "Shadow_Inventory",
        "Auto-Enrichment-Pending",
        "Auto_Archived_Bad_Data",
        "Shadow_Matched",
        "Pending-Underwriting",
        "Funds-Suspended",
      ],
      app_role: ["admin", "moderator", "user", "viewer"],
      buyer_persona: [
        "EXCHANGE_1031",
        "CONVERSION_1033",
        "QOZ_FUND",
        "BONUS_DEPRECIATION",
        "SDIRA_CASH",
        "TIMO_SAWMILL",
        "DRY_POWDER",
        "HARD_MONEY_RECYCLER",
        "ADJACENT_OWNER",
        "BTR_INFILL",
        "GENERIC",
      ],
      cre_asset_class: [
        "MULTIFAMILY_5PLUS",
        "LIGHT_INDUSTRIAL",
        "NNN_RETAIL",
        "FLEX_STORAGE",
        "COMMERCIAL_LAND",
        "NON_COMMERCIAL",
      ],
      offer_delivery_status: [
        "DISPATCHED",
        "DELIVERED",
        "OPENED",
        "CLICKED",
        "REJECTED",
        "EXECUTED",
      ],
      offer_rejection_code: [
        "YIELD_BELOW_HURDLE",
        "LIEN_THRESHOLD_EXCEEDED",
        "GEO_OUT_OF_BOUNDS",
        "EMD_RAIL_MISMATCH",
        "CAPITAL_SATURATED",
        "CUSTOM_OTHER",
      ],
      title_package_status: [
        "Queued",
        "Built",
        "Sent",
        "Acknowledged",
        "Failed",
      ],
      title_status_enum: ["Insured", "Uninsurable", "Pending"],
    },
  },
} as const
