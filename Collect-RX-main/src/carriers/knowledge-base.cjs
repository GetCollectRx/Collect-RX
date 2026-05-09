/**
 * Knowledge Base Utilities
 * Functions for loading, querying, and managing carrier configurations
 */

const fs = require('fs').promises;
const path = require('path');

class CarrierKnowledgeBase {
  constructor(carriersDirectory = './carriers') {
    this.carriersDirectory = carriersDirectory;
    this.carriers = new Map();
    this.loaded = false;
  }

  /**
   * Load all carrier configurations from JSON files
   */
  async loadCarriers() {
    try {
      const files = await fs.readdir(this.carriersDirectory);
      const jsonFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('_'));
      
      for (const file of jsonFiles) {
        const filePath = path.join(this.carriersDirectory, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const carrier = JSON.parse(content);
        
        // Validate required fields
        if (!carrier.carrier_id || !carrier.carrier_name) {
          console.warn(`Skipping invalid carrier file: ${file}`);
          continue;
        }
        
        this.carriers.set(carrier.carrier_id, carrier);
      }
      
      this.loaded = true;
      console.log(`Loaded ${this.carriers.size} carrier configurations`);
    } catch (error) {
      console.error('Error loading carriers:', error);
      throw error;
    }
  }

  /**
   * Get carrier by ID
   */
  getCarrier(carrierId) {
    if (!this.loaded) {
      throw new Error('Carriers not loaded. Call loadCarriers() first.');
    }
    return this.carriers.get(carrierId);
  }

  /**
   * Get carrier by name (case-insensitive partial match)
   */
  findCarrierByName(carrierName) {
    if (!this.loaded) {
      throw new Error('Carriers not loaded. Call loadCarriers() first.');
    }
    
    const searchTerm = carrierName.toLowerCase();
    
    for (const [id, carrier] of this.carriers.entries()) {
      if (carrier.carrier_name.toLowerCase().includes(searchTerm)) {
        return carrier;
      }
    }
    
    return null;
  }

  /**
   * Determine which carrier config to use based on claim data
   */
  getCarrierForClaim(claim) {
    if (!this.loaded) {
      throw new Error('Carriers not loaded. Call loadCarriers() first.');
    }

    const insuranceType = claim.insurance?.type;
    const carrierName = claim.insurance?.carrier_name;

    // CDCP claims always go to cdcp_sunlife
    if (insuranceType === 'CDCP') {
      return this.getCarrier('cdcp_sunlife');
    }

    // Private insurance - try to find by name
    if (carrierName) {
      const carrier = this.findCarrierByName(carrierName);
      if (carrier && carrier.carrier_type === 'PRIVATE') {
        return carrier;
      }
    }

    return null;
  }

  /**
   * Get all active carriers
   */
  getActiveCarriers() {
    if (!this.loaded) {
      throw new Error('Carriers not loaded. Call loadCarriers() first.');
    }
    
    return Array.from(this.carriers.values()).filter(c => c.active);
  }

  /**
   * Get carriers by type
   */
  getCarriersByType(type) {
    if (!this.loaded) {
      throw new Error('Carriers not loaded. Call loadCarriers() first.');
    }
    
    return Array.from(this.carriers.values()).filter(c => c.carrier_type === type);
  }

  /**
   * Get IVR navigation steps for a carrier
   */
  getIVRSteps(carrierId) {
    const carrier = this.getCarrier(carrierId);
    return carrier?.ivr_navigation?.steps || [];
  }

  /**
   * Get authentication requirements for a carrier
   */
  getAuthRequirements(carrierId) {
    const carrier = this.getCarrier(carrierId);
    return carrier?.authentication || null;
  }

  /**
   * Get AI agent guidance for a carrier
   */
  getAgentGuidance(carrierId) {
    const carrier = this.getCarrier(carrierId);
    return carrier?.ai_agent_guidance || null;
  }

  /**
   * Build a dynamic system prompt for an AI agent based on claim and carrier
   */
  buildSystemPrompt(claim, carrier) {
    const guidance = carrier.ai_agent_guidance || {};
    const auth = carrier.authentication || {};
    const cdcp = carrier.cdcp_specific || {};

    let prompt = `You are a professional billing administrator calling on behalf of ${claim.provider.practice_name}.

CARRIER: ${carrier.carrier_name}
CARRIER TYPE: ${carrier.carrier_type}
PROVIDER PHONE: ${carrier.contact_info.provider_phone}

YOUR CLAIM:
- Patient: ${claim.patient.name}
- Date of Birth: ${claim.patient.dob}
- Member ID: ${claim.patient.member_id}
- Date of Service: ${claim.claim_details.date_of_service}
- Procedures: ${claim.claim_details.procedure_codes.join(', ')}
- Amount: $${claim.claim_details.amount_billed}
- Days Outstanding: ${claim.claim_details.days_outstanding}

AUTHENTICATION INFO:
${auth.required_fields?.map(field => `- ${field}: ${this.getClaimField(claim, field)}`).join('\n')}

YOUR GOAL:
1. Determine the claim status (pending, processing, denied, paid)
2. Identify why the claim has not been paid
3. Get specific documentation requirements or denial reasons
4. Obtain a reference number for this inquiry
5. Confirm expected payment or resolution timeline

`;

    // Add CDCP-specific guidance
    if (carrier.carrier_type === 'CDCP') {
      prompt += `
CDCP-SPECIFIC REQUIREMENTS:
- This is a federal government dental plan
- CDCP is the "payer of last resort" - verify no other coverage
- Patient copay tier: ${claim.insurance.copay_tier || 'UNKNOWN - ASK REP'}
- Predetermination required for services over $${cdcp.predetermination_threshold}

CRITICAL QUESTIONS TO ASK:
- "Can you confirm the patient's copay tier percentage?"
- "Does the system show any other dental coverage for this patient?"
- "Was a predetermination received and approved?"

`;
    }

    // Add key phrases
    if (guidance.key_phrases && guidance.key_phrases.length > 0) {
      prompt += `\nEFFECTIVE PHRASES FOR THIS CARRIER:\n`;
      guidance.key_phrases.forEach(phrase => {
        prompt += `- "${phrase}"\n`;
      });
    }

    // Add things to avoid
    if (guidance.avoid_phrases && guidance.avoid_phrases.length > 0) {
      prompt += `\nDO NOT SAY:\n`;
      guidance.avoid_phrases.forEach(phrase => {
        prompt += `- "${phrase}"\n`;
      });
    }

    // Add escalation triggers
    if (guidance.escalation_triggers && guidance.escalation_triggers.length > 0) {
      prompt += `\nESCALATE TO HUMAN IF:\n`;
      guidance.escalation_triggers.forEach(trigger => {
        prompt += `- ${trigger}\n`;
      });
    }

    prompt += `\nTONE: Maintain a ${guidance.tone || 'professional'} tone throughout the call.

If you cannot get the information needed or encounter unexpected issues, politely end the call and flag this claim for human follow-up with detailed notes about what happened.
`;

    return prompt;
  }

  /**
   * Helper to extract field from claim object using dot notation
   */
  getClaimField(claim, fieldPath) {
    const mapping = {
      'provider_id': claim.provider?.npi_equivalent,
      'cdcp_provider_number': claim.provider?.cdcp_provider_number,
      'practice_name': claim.provider?.practice_name,
      'practice_phone': claim.provider?.phone,
      'practice_address': claim.provider?.address,
      'patient_member_id': claim.patient?.member_id,
      'patient_dob': claim.patient?.dob,
      'patient_health_card': claim.patient?.health_card,
      'group_number': claim.insurance?.group_number,
      'date_of_service': claim.claim_details?.date_of_service,
      'claim_number': claim.claim_details?.claim_number
    };

    return mapping[fieldPath] || 'NOT_PROVIDED';
  }

  /**
   * Get common denial reasons for a carrier
   */
  getCommonDenials(carrierId) {
    const carrier = this.getCarrier(carrierId);
    return carrier?.claim_processing?.common_denial_reasons || [];
  }

  /**
   * Find resolution for a specific denial code
   */
  findDenialResolution(carrierId, denialCode) {
    const denials = this.getCommonDenials(carrierId);
    const denial = denials.find(d => d.code === denialCode);
    return denial?.resolution || 'Unknown denial code - escalate to human';
  }

  /**
   * Get call metrics for reporting
   */
  getCallMetrics(carrierId) {
    const carrier = this.getCarrier(carrierId);
    return carrier?.call_metrics || null;
  }

  /**
   * Update carrier configuration (for learning/improvement)
   */
  async updateCarrier(carrierId, updates) {
    const carrier = this.getCarrier(carrierId);
    if (!carrier) {
      throw new Error(`Carrier ${carrierId} not found`);
    }

    // Merge updates
    const updated = { ...carrier, ...updates };
    
    // Update last_updated timestamp
    updated.metadata = updated.metadata || {};
    updated.metadata.last_updated = new Date().toISOString();
    
    // Add to change log
    updated.metadata.change_log = updated.metadata.change_log || [];
    updated.metadata.change_log.push({
      date: new Date().toISOString().split('T')[0],
      change: JSON.stringify(updates),
      reason: 'Auto-update from system learning'
    });

    // Save to file
    const filePath = path.join(this.carriersDirectory, `${carrierId}.json`);
    await fs.writeFile(filePath, JSON.stringify(updated, null, 2));

    // Update in-memory cache
    this.carriers.set(carrierId, updated);

    return updated;
  }

  /**
   * Record call outcome for learning
   */
  async recordCallOutcome(carrierId, outcome) {
    // This would be used to track what works and what doesn't
    // Could update call_metrics, ivr_navigation accuracy, etc.
    
    const carrier = this.getCarrier(carrierId);
    if (!carrier) return;

    const updates = {};

    // Update IVR navigation accuracy
    if (outcome.ivr_navigation_worked === true) {
      updates['ivr_navigation.last_verified'] = new Date().toISOString().split('T')[0];
    }

    // Update average hold time (rolling average)
    if (outcome.hold_time_minutes) {
      const currentAvg = carrier.call_metrics?.average_hold_time_minutes || 0;
      const newAvg = Math.round((currentAvg * 0.9) + (outcome.hold_time_minutes * 0.1));
      updates['call_metrics.average_hold_time_minutes'] = newAvg;
    }

    // If there were auth issues, lower confidence score
    if (outcome.authentication_failed) {
      const currentScore = carrier.metadata?.confidence_score || 50;
      updates['metadata.confidence_score'] = Math.max(0, currentScore - 5);
    }

    if (Object.keys(updates).length > 0) {
      await this.updateCarrier(carrierId, updates);
    }
  }

  /**
   * Get statistics about the knowledge base
   */
  getStats() {
    if (!this.loaded) {
      throw new Error('Carriers not loaded. Call loadCarriers() first.');
    }

    const carriers = Array.from(this.carriers.values());
    
    return {
      total_carriers: carriers.length,
      active_carriers: carriers.filter(c => c.active).length,
      by_type: {
        CDCP: carriers.filter(c => c.carrier_type === 'CDCP').length,
        PRIVATE: carriers.filter(c => c.carrier_type === 'PRIVATE').length,
        HYBRID: carriers.filter(c => c.carrier_type === 'HYBRID').length
      },
      total_market_coverage: carriers.reduce((sum, c) => sum + (c.market_share || 0), 0),
      average_confidence: Math.round(
        carriers.reduce((sum, c) => sum + (c.metadata?.confidence_score || 0), 0) / carriers.length
      ),
      carriers_needing_verification: carriers.filter(c => {
        const lastVerified = c.ivr_navigation?.last_verified;
        if (!lastVerified) return true;
        const daysSince = Math.floor((Date.now() - new Date(lastVerified)) / (1000 * 60 * 60 * 24));
        return daysSince > 90; // More than 90 days old
      }).map(c => c.carrier_id)
    };
  }
}

module.exports = CarrierKnowledgeBase;

// Example usage:
/*
const kb = new CarrierKnowledgeBase('./carriers');
await kb.loadCarriers();

const claim = {
  insurance: { type: 'CDCP', carrier_name: 'Sun Life' },
  patient: { name: 'John Doe', dob: '1985-03-15', member_id: 'AB123456' },
  provider: { practice_name: 'Maple Dental', phone: '416-555-0100' },
  claim_details: { date_of_service: '2025-01-15', procedure_codes: ['D2740'], amount_billed: 850 }
};

const carrier = kb.getCarrierForClaim(claim);
const prompt = kb.buildSystemPrompt(claim, carrier);
const ivrSteps = kb.getIVRSteps(carrier.carrier_id);

console.log(prompt);
console.log(kb.getStats());
*/
