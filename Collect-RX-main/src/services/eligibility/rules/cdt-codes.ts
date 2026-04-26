// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — CDT Code → Coverage Tier Mapping
// Covers the full common CDT code range (D0100–D9999)
// Source: ADA CDT nomenclature categories
// ─────────────────────────────────────────────────────────────────────────────

import { CoverageTier } from '../types';

// A record of CDT code → tier. Unknown codes default to 'basic'.
// Stored as a flat map for O(1) lookup; prefix ranges handled by
// getCoverageTier() for codes not explicitly listed.
const CDT_CODE_MAP: Record<string, CoverageTier> = {
  // ─────────────────────────────────────────────────────────────
  // D0100–D0999 — Diagnostic
  // ─────────────────────────────────────────────────────────────
  D0120: CoverageTier.Preventive, // Periodic oral evaluation
  D0140: CoverageTier.Basic,      // Limited oral evaluation — problem focused
  D0145: CoverageTier.Preventive, // Oral evaluation — patient under 3
  D0150: CoverageTier.Preventive, // Comprehensive oral evaluation
  D0160: CoverageTier.Basic,      // Detailed/extensive oral evaluation
  D0170: CoverageTier.Basic,      // Re-evaluation — limited
  D0180: CoverageTier.Basic,      // Comprehensive perio evaluation

  D0210: CoverageTier.Preventive, // Intraoral complete series X-rays
  D0220: CoverageTier.Preventive, // Periapical X-ray (first image)
  D0230: CoverageTier.Preventive, // Periapical X-ray (each additional)
  D0240: CoverageTier.Preventive, // Occlusal X-ray
  D0250: CoverageTier.Basic,      // Extra-oral 2D projection (skull)
  D0270: CoverageTier.Preventive, // Bitewing X-ray (single image)
  D0272: CoverageTier.Preventive, // Bitewing X-rays (two images)
  D0273: CoverageTier.Preventive, // Bitewing X-rays (three images)
  D0274: CoverageTier.Preventive, // Bitewing X-rays (four images)
  D0277: CoverageTier.Preventive, // Vertical bitewings (7–8 images)
  D0310: CoverageTier.Basic,      // Sialography
  D0320: CoverageTier.Basic,      // TMJ arthrogram
  D0330: CoverageTier.Basic,      // Panoramic radiographic image
  D0340: CoverageTier.Basic,      // 2D cephalometric radiographic image
  D0350: CoverageTier.Basic,      // 2D oral/facial photographic image
  D0360: CoverageTier.Basic,      // Cone beam CT — craniofacial structures
  D0364: CoverageTier.Basic,      // Cone beam CT — limited field

  D0415: CoverageTier.Basic,      // Collection of microorganisms
  D0416: CoverageTier.Basic,      // Viral culture
  D0417: CoverageTier.Basic,      // Collection specimen — brush biopsy
  D0418: CoverageTier.Basic,      // Chemical analysis of saliva

  D0460: CoverageTier.Basic,      // Pulp vitality tests
  D0470: CoverageTier.Basic,      // Diagnostic casts
  D0480: CoverageTier.Basic,      // Accession of exfoliative cytological smear
  D0486: CoverageTier.Basic,      // Accession — brush biopsy specimen

  D0502: CoverageTier.Basic,      // Other oral pathology procedures
  D0601: CoverageTier.Basic,      // Caries risk assessment
  D0602: CoverageTier.Basic,      // Caries risk assessment (moderate)
  D0603: CoverageTier.Basic,      // Caries risk assessment (high)

  // ─────────────────────────────────────────────────────────────
  // D1000–D1999 — Preventive
  // ─────────────────────────────────────────────────────────────
  D1110: CoverageTier.Preventive, // Adult prophylaxis (cleaning)
  D1120: CoverageTier.Preventive, // Child prophylaxis
  D1206: CoverageTier.Preventive, // Topical fluoride varnish
  D1208: CoverageTier.Preventive, // Topical fluoride (other)
  D1310: CoverageTier.Preventive, // Nutritional counseling
  D1320: CoverageTier.Preventive, // Tobacco counseling
  D1321: CoverageTier.Preventive, // Counseling — cessation (1st appointment)
  D1330: CoverageTier.Preventive, // Oral hygiene instruction
  D1351: CoverageTier.Preventive, // Sealant — per tooth
  D1352: CoverageTier.Preventive, // Preventive resin restoration
  D1353: CoverageTier.Preventive, // Sealant repair
  D1354: CoverageTier.Preventive, // Interim caries arresting medicament
  D1510: CoverageTier.Preventive, // Space maintainer — fixed, unilateral
  D1515: CoverageTier.Preventive, // Space maintainer — fixed, bilateral
  D1520: CoverageTier.Preventive, // Space maintainer — removable, unilateral
  D1525: CoverageTier.Preventive, // Space maintainer — removable, bilateral
  D1550: CoverageTier.Preventive, // Re-cementation / repair of space maintainer
  D1556: CoverageTier.Preventive, // Removal of fixed space maintainer
  D1557: CoverageTier.Preventive, // Removal of fixed bilateral space maintainer

  // ─────────────────────────────────────────────────────────────
  // D2000–D2999 — Restorative
  // ─────────────────────────────────────────────────────────────
  D2140: CoverageTier.Basic,      // Amalgam restoration — 1 surface, primary
  D2150: CoverageTier.Basic,      // Amalgam restoration — 2 surfaces, primary
  D2160: CoverageTier.Basic,      // Amalgam restoration — 3 surfaces, primary
  D2161: CoverageTier.Basic,      // Amalgam restoration — 4+ surfaces, primary
  D2390: CoverageTier.Basic,      // Resin-based composite (anterior)
  D2391: CoverageTier.Basic,      // Resin composite — 1 surface, primary
  D2392: CoverageTier.Basic,      // Resin composite — 2 surfaces, primary
  D2393: CoverageTier.Basic,      // Resin composite — 3 surfaces, primary
  D2394: CoverageTier.Basic,      // Resin composite — 4+ surfaces, primary

  D2510: CoverageTier.Major,      // Inlay — metallic — 1 surface
  D2520: CoverageTier.Major,      // Inlay — metallic — 2 surfaces
  D2530: CoverageTier.Major,      // Inlay — metallic — 3+ surfaces
  D2542: CoverageTier.Major,      // Onlay — metallic — 2 surfaces
  D2543: CoverageTier.Major,      // Onlay — metallic — 3 surfaces
  D2544: CoverageTier.Major,      // Onlay — metallic — 4+ surfaces

  D2610: CoverageTier.Major,      // Inlay — porcelain/ceramic — 1 surface
  D2620: CoverageTier.Major,      // Inlay — porcelain/ceramic — 2 surfaces
  D2630: CoverageTier.Major,      // Inlay — porcelain/ceramic — 3+ surfaces
  D2642: CoverageTier.Major,      // Onlay — porcelain/ceramic — 2 surfaces
  D2643: CoverageTier.Major,      // Onlay — porcelain/ceramic — 3 surfaces
  D2644: CoverageTier.Major,      // Onlay — porcelain/ceramic — 4+ surfaces

  D2710: CoverageTier.Major,      // Crown — resin-based composite (indirect)
  D2712: CoverageTier.Major,      // Crown — ¾ resin-based composite (indirect)
  D2720: CoverageTier.Major,      // Crown — resin with high noble metal
  D2721: CoverageTier.Major,      // Crown — resin with predominantly base metal
  D2722: CoverageTier.Major,      // Crown — resin with noble metal
  D2740: CoverageTier.Major,      // Crown — porcelain/ceramic substrate
  D2750: CoverageTier.Major,      // Crown — porcelain fused to high noble metal
  D2751: CoverageTier.Major,      // Crown — porcelain fused to predominantly base metal
  D2752: CoverageTier.Major,      // Crown — porcelain fused to noble metal
  D2780: CoverageTier.Major,      // Crown — 3/4 cast high noble metal
  D2781: CoverageTier.Major,      // Crown — 3/4 cast predominantly base metal
  D2782: CoverageTier.Major,      // Crown — 3/4 cast noble metal
  D2783: CoverageTier.Major,      // Crown — 3/4 porcelain/ceramic
  D2790: CoverageTier.Major,      // Crown — full cast high noble metal
  D2791: CoverageTier.Major,      // Crown — full cast predominantly base metal
  D2792: CoverageTier.Major,      // Crown — full cast noble metal
  D2794: CoverageTier.Major,      // Crown — titanium

  D2910: CoverageTier.Basic,      // Re-cement or re-bond inlay/onlay/partial coverage restoration
  D2915: CoverageTier.Basic,      // Re-cement or re-bond indirectly fabricated restoration
  D2920: CoverageTier.Basic,      // Re-cement or re-bond crown
  D2930: CoverageTier.Basic,      // Prefabricated stainless steel crown — primary tooth
  D2931: CoverageTier.Basic,      // Prefabricated stainless steel crown — permanent tooth
  D2932: CoverageTier.Basic,      // Prefabricated resin crown
  D2933: CoverageTier.Basic,      // Prefabricated stainless steel crown with resin window
  D2934: CoverageTier.Basic,      // Prefabricated esthetic coated stainless steel crown
  D2940: CoverageTier.Basic,      // Protective restoration
  D2950: CoverageTier.Basic,      // Core buildup including any pins when required
  D2951: CoverageTier.Basic,      // Pin retention — per tooth
  D2952: CoverageTier.Major,      // Cast post and core — prefabricated
  D2953: CoverageTier.Major,      // Each additional prefabricated post — same tooth
  D2954: CoverageTier.Major,      // Prefabricated post and core — prefabricated post
  D2957: CoverageTier.Major,      // Each additional prefabricated post — same tooth
  D2960: CoverageTier.Basic,      // Labial veneer — resin laminate — chairside
  D2961: CoverageTier.Major,      // Labial veneer — resin laminate — laboratory
  D2962: CoverageTier.Major,      // Labial veneer — porcelain laminate — laboratory
  D2971: CoverageTier.Basic,      // Additional procedures to construct new crown

  // ─────────────────────────────────────────────────────────────
  // D3000–D3999 — Endodontics
  // ─────────────────────────────────────────────────────────────
  D3110: CoverageTier.Basic,      // Pulp cap — direct (excluding final restoration)
  D3120: CoverageTier.Basic,      // Pulp cap — indirect (excluding final restoration)
  D3220: CoverageTier.Basic,      // Therapeutic pulpotomy (excluding final restoration)
  D3221: CoverageTier.Basic,      // Pulpal debridement, primary and permanent teeth
  D3230: CoverageTier.Basic,      // Pulpal therapy — anterior primary tooth
  D3240: CoverageTier.Basic,      // Pulpal therapy — posterior primary tooth

  D3310: CoverageTier.Basic,      // Endodontic therapy — anterior tooth
  D3320: CoverageTier.Basic,      // Endodontic therapy — premolar tooth
  D3330: CoverageTier.Basic,      // Endodontic therapy — molar tooth
  D3331: CoverageTier.Basic,      // Treatment of root canal — molar (3 canals)
  D3332: CoverageTier.Basic,      // Incomplete endodontic therapy — inoperable
  D3333: CoverageTier.Basic,      // Internal root repair — perforation defects
  D3346: CoverageTier.Basic,      // Retreatment of previous root canal therapy — anterior
  D3347: CoverageTier.Basic,      // Retreatment — premolar
  D3348: CoverageTier.Basic,      // Retreatment — molar

  D3410: CoverageTier.Major,      // Apicoectomy — anterior
  D3421: CoverageTier.Major,      // Apicoectomy — premolar (first root)
  D3425: CoverageTier.Major,      // Apicoectomy — molar (first root)
  D3426: CoverageTier.Major,      // Apicoectomy (each additional root)
  D3430: CoverageTier.Major,      // Retrograde filling — per root
  D3450: CoverageTier.Major,      // Root amputation — per root
  D3460: CoverageTier.Major,      // Endodontic endosseous implant
  D3910: CoverageTier.Basic,      // Surgical procedure for isolation of tooth
  D3920: CoverageTier.Basic,      // Hemisection
  D3950: CoverageTier.Basic,      // Canal preparation and fitting of preformed dowel or post

  // ─────────────────────────────────────────────────────────────
  // D4000–D4999 — Periodontics
  // ─────────────────────────────────────────────────────────────
  D4210: CoverageTier.Major,      // Gingivectomy or gingivoplasty — per quadrant
  D4211: CoverageTier.Major,      // Gingivectomy or gingivoplasty — per tooth
  D4212: CoverageTier.Major,      // Gingivectomy or gingivoplasty — single tooth
  D4240: CoverageTier.Major,      // Gingival flap procedure — per quadrant
  D4241: CoverageTier.Major,      // Gingival flap — one to three teeth
  D4245: CoverageTier.Major,      // Apically positioned flap
  D4249: CoverageTier.Major,      // Clinical crown lengthening — hard tissue
  D4260: CoverageTier.Major,      // Osseous surgery — per quadrant
  D4261: CoverageTier.Major,      // Osseous surgery — one to three teeth
  D4270: CoverageTier.Major,      // Pedicle soft tissue graft
  D4271: CoverageTier.Major,      // Free soft tissue graft
  D4273: CoverageTier.Major,      // Autogenous connective tissue graft
  D4274: CoverageTier.Major,      // Mesial/distal wedge procedure
  D4275: CoverageTier.Major,      // Non-autogenous connective tissue graft
  D4276: CoverageTier.Major,      // Combined connective tissue and double pedicle graft

  D4320: CoverageTier.Basic,      // Provisional splinting — intracoronal
  D4321: CoverageTier.Basic,      // Provisional splinting — extracoronal
  D4341: CoverageTier.Basic,      // Periodontal scaling and root planing — per quadrant
  D4342: CoverageTier.Basic,      // Periodontal scaling and root planing — one to three teeth
  D4346: CoverageTier.Basic,      // Scaling in presence of generalized moderate or severe gingival inflammation
  D4355: CoverageTier.Basic,      // Full mouth debridement
  D4381: CoverageTier.Basic,      // Localized delivery of antimicrobial agents — per tooth
  D4910: CoverageTier.Preventive, // Periodontal maintenance
  D4920: CoverageTier.Basic,      // Unscheduled dressing change — by someone other than treating dentist

  // ─────────────────────────────────────────────────────────────
  // D5000–D5899 — Prosthodontics, Removable
  // ─────────────────────────────────────────────────────────────
  D5110: CoverageTier.Major,      // Complete denture — maxillary
  D5120: CoverageTier.Major,      // Complete denture — mandibular
  D5130: CoverageTier.Major,      // Immediate complete denture — maxillary
  D5140: CoverageTier.Major,      // Immediate complete denture — mandibular
  D5211: CoverageTier.Major,      // Maxillary partial denture — resin base
  D5212: CoverageTier.Major,      // Mandibular partial denture — resin base
  D5213: CoverageTier.Major,      // Maxillary partial denture — cast metal framework
  D5214: CoverageTier.Major,      // Mandibular partial denture — cast metal framework
  D5221: CoverageTier.Major,      // Immediate maxillary partial denture — resin base
  D5222: CoverageTier.Major,      // Immediate mandibular partial denture — resin base
  D5223: CoverageTier.Major,      // Immediate maxillary partial denture — cast metal
  D5224: CoverageTier.Major,      // Immediate mandibular partial denture — cast metal
  D5281: CoverageTier.Major,      // Removable unilateral partial denture — one piece cast
  D5410: CoverageTier.Basic,      // Adjust complete denture — maxillary
  D5411: CoverageTier.Basic,      // Adjust complete denture — mandibular
  D5421: CoverageTier.Basic,      // Adjust partial denture — maxillary
  D5422: CoverageTier.Basic,      // Adjust partial denture — mandibular
  D5511: CoverageTier.Basic,      // Repair broken complete denture base — mandibular
  D5512: CoverageTier.Basic,      // Repair broken complete denture base — maxillary
  D5520: CoverageTier.Basic,      // Replace missing or broken teeth — complete denture
  D5610: CoverageTier.Basic,      // Repair resin denture base — maxillary
  D5620: CoverageTier.Basic,      // Repair cast framework — partial denture
  D5630: CoverageTier.Basic,      // Repair or replace broken clasp — per tooth
  D5640: CoverageTier.Basic,      // Replace broken teeth — per tooth
  D5650: CoverageTier.Basic,      // Add tooth to existing partial denture
  D5660: CoverageTier.Basic,      // Add clasp to existing partial denture — per tooth
  D5670: CoverageTier.Basic,      // Replace all teeth and acrylic on cast metal framework (maxillary)
  D5671: CoverageTier.Basic,      // Replace all teeth and acrylic on cast metal framework (mandibular)
  D5710: CoverageTier.Major,      // Rebase complete maxillary denture
  D5711: CoverageTier.Major,      // Rebase complete mandibular denture
  D5720: CoverageTier.Major,      // Rebase maxillary partial denture
  D5721: CoverageTier.Major,      // Rebase mandibular partial denture
  D5730: CoverageTier.Basic,      // Reline complete maxillary denture (chairside)
  D5731: CoverageTier.Basic,      // Reline complete mandibular denture (chairside)
  D5740: CoverageTier.Basic,      // Reline maxillary partial denture (chairside)
  D5741: CoverageTier.Basic,      // Reline mandibular partial denture (chairside)
  D5750: CoverageTier.Major,      // Reline complete maxillary denture (laboratory)
  D5751: CoverageTier.Major,      // Reline complete mandibular denture (laboratory)
  D5760: CoverageTier.Major,      // Reline maxillary partial denture (laboratory)
  D5761: CoverageTier.Major,      // Reline mandibular partial denture (laboratory)
  D5850: CoverageTier.Basic,      // Tissue conditioning — maxillary
  D5851: CoverageTier.Basic,      // Tissue conditioning — mandibular
  D5862: CoverageTier.Major,      // Precision attachment — per attachment
  D5863: CoverageTier.Major,      // Overdenture — complete maxillary
  D5864: CoverageTier.Major,      // Overdenture — partial maxillary
  D5865: CoverageTier.Major,      // Overdenture — complete mandibular
  D5866: CoverageTier.Major,      // Overdenture — partial mandibular

  // ─────────────────────────────────────────────────────────────
  // D6000–D6199 — Implant Services
  // ─────────────────────────────────────────────────────────────
  D6010: CoverageTier.Major,      // Surgical placement of implant body — endosteal implant
  D6040: CoverageTier.Major,      // Surgical placement — eposteal implant
  D6050: CoverageTier.Major,      // Surgical placement — transosteal implant
  D6051: CoverageTier.Major,      // Interim abutment
  D6052: CoverageTier.Major,      // Semi-precision attachment abutment
  D6055: CoverageTier.Major,      // Connecting bar — implant supported or abutment supported
  D6056: CoverageTier.Major,      // Prefabricated abutment — stock
  D6057: CoverageTier.Major,      // Custom fabricated abutment
  D6058: CoverageTier.Major,      // Abutment supported porcelain/ceramic crown
  D6059: CoverageTier.Major,      // Abutment supported PFM crown (high noble)
  D6060: CoverageTier.Major,      // Abutment supported cast metal crown (high noble)
  D6061: CoverageTier.Major,      // Abutment supported resin crown (indirect)
  D6062: CoverageTier.Major,      // Abutment supported cast metal crown (predominantly base)
  D6063: CoverageTier.Major,      // Abutment supported PFM crown (predominantly base)
  D6064: CoverageTier.Major,      // Abutment supported PFM crown (noble metal)
  D6065: CoverageTier.Major,      // Implant supported PFM crown (predominantly base)
  D6066: CoverageTier.Major,      // Implant supported crown — porcelain/ceramic
  D6067: CoverageTier.Major,      // Implant supported metal crown (high noble)
  D6068: CoverageTier.Major,      // Abutment supported retainer — porcelain/ceramic
  D6069: CoverageTier.Major,      // Abutment supported retainer — cast metal (high noble)
  D6070: CoverageTier.Major,      // Abutment supported retainer — resin (indirect)

  // ─────────────────────────────────────────────────────────────
  // D6200–D6999 — Prosthodontics, Fixed
  // ─────────────────────────────────────────────────────────────
  D6210: CoverageTier.Major,      // Pontic — cast high noble metal
  D6211: CoverageTier.Major,      // Pontic — cast predominantly base metal
  D6212: CoverageTier.Major,      // Pontic — cast noble metal
  D6214: CoverageTier.Major,      // Pontic — titanium
  D6240: CoverageTier.Major,      // Pontic — porcelain fused to high noble metal
  D6241: CoverageTier.Major,      // Pontic — porcelain fused to predominantly base metal
  D6242: CoverageTier.Major,      // Pontic — porcelain fused to noble metal
  D6245: CoverageTier.Major,      // Pontic — porcelain/ceramic
  D6250: CoverageTier.Major,      // Pontic — resin with high noble metal
  D6251: CoverageTier.Major,      // Pontic — resin with predominantly base metal
  D6252: CoverageTier.Major,      // Pontic — resin with noble metal
  D6545: CoverageTier.Major,      // Retainer — cast metal for resin bonded prosthesis
  D6548: CoverageTier.Major,      // Retainer — porcelain/ceramic for resin bonded prosthesis
  D6549: CoverageTier.Major,      // Resin retainer — for resin bonded prosthesis
  D6600: CoverageTier.Major,      // Retainer inlay — porcelain/ceramic, 2 surfaces
  D6601: CoverageTier.Major,      // Retainer inlay — porcelain/ceramic, 3+ surfaces
  D6602: CoverageTier.Major,      // Retainer inlay — cast high noble, 2 surfaces
  D6603: CoverageTier.Major,      // Retainer inlay — cast high noble, 3+ surfaces
  D6710: CoverageTier.Major,      // Retainer crown — indirect resin based composite
  D6720: CoverageTier.Major,      // Retainer crown — resin with high noble metal
  D6721: CoverageTier.Major,      // Retainer crown — resin with predominantly base metal
  D6722: CoverageTier.Major,      // Retainer crown — resin with noble metal
  D6740: CoverageTier.Major,      // Retainer crown — porcelain/ceramic
  D6750: CoverageTier.Major,      // Retainer crown — porcelain fused to high noble metal
  D6751: CoverageTier.Major,      // Retainer crown — porcelain fused to predominantly base metal
  D6752: CoverageTier.Major,      // Retainer crown — porcelain fused to noble metal
  D6780: CoverageTier.Major,      // Retainer crown — 3/4 cast high noble metal
  D6781: CoverageTier.Major,      // Retainer crown — 3/4 cast predominantly base metal
  D6782: CoverageTier.Major,      // Retainer crown — 3/4 cast noble metal
  D6783: CoverageTier.Major,      // Retainer crown — 3/4 porcelain/ceramic
  D6790: CoverageTier.Major,      // Retainer crown — full cast high noble metal
  D6791: CoverageTier.Major,      // Retainer crown — full cast predominantly base metal
  D6792: CoverageTier.Major,      // Retainer crown — full cast noble metal
  D6794: CoverageTier.Major,      // Retainer crown — titanium
  D6930: CoverageTier.Basic,      // Re-cement or re-bond fixed partial denture
  D6940: CoverageTier.Basic,      // Stress breaker
  D6950: CoverageTier.Basic,      // Precision attachment
  D6980: CoverageTier.Basic,      // Fixed partial denture repair

  // ─────────────────────────────────────────────────────────────
  // D7000–D7999 — Oral & Maxillofacial Surgery
  // ─────────────────────────────────────────────────────────────
  D7111: CoverageTier.Basic,      // Extraction — coronal remnants — primary tooth
  D7140: CoverageTier.Basic,      // Extraction — erupted tooth or exposed root
  D7210: CoverageTier.Basic,      // Surgical extraction — erupted tooth
  D7220: CoverageTier.Basic,      // Removal — impacted tooth — soft tissue
  D7230: CoverageTier.Basic,      // Removal — impacted tooth — partial bony
  D7240: CoverageTier.Basic,      // Removal — impacted tooth — completely bony
  D7241: CoverageTier.Basic,      // Removal — impacted tooth — completely bony with unusual surgical complications
  D7250: CoverageTier.Basic,      // Surgical removal — residual tooth roots
  D7260: CoverageTier.Basic,      // Oroantral fistula closure
  D7261: CoverageTier.Basic,      // Primary closure of a sinus perforation
  D7270: CoverageTier.Basic,      // Tooth reimplantation
  D7272: CoverageTier.Basic,      // Tooth transplantation
  D7280: CoverageTier.Basic,      // Surgical access of an unerupted tooth
  D7282: CoverageTier.Basic,      // Mobilization of erupted or malpositioned tooth
  D7283: CoverageTier.Basic,      // Placement of device to facilitate eruption of impacted tooth
  D7285: CoverageTier.Basic,      // Incisional biopsy of oral tissue — hard
  D7286: CoverageTier.Basic,      // Incisional biopsy of oral tissue — soft
  D7287: CoverageTier.Basic,      // Exfoliative cytological sample collection
  D7288: CoverageTier.Basic,      // Brush biopsy — transepithelial sample collection
  D7290: CoverageTier.Basic,      // Surgical repositioning of teeth
  D7291: CoverageTier.Basic,      // Transseptal fiberotomy/supra crestal fiberotomy
  D7310: CoverageTier.Basic,      // Alveoloplasty in conjunction with extractions — per quadrant
  D7311: CoverageTier.Basic,      // Alveoloplasty — 1 to 3 teeth or tooth spaces (per quadrant)
  D7320: CoverageTier.Basic,      // Alveoloplasty not in conjunction with extractions — per quadrant
  D7321: CoverageTier.Basic,      // Alveoloplasty not in conjunction — 1 to 3 teeth (per quadrant)
  D7340: CoverageTier.Basic,      // Vestibuloplasty — ridge extension
  D7350: CoverageTier.Major,      // Vestibuloplasty — ridge extension (secondary epithelialization)
  D7410: CoverageTier.Basic,      // Excision of benign lesion — up to 1.25 cm
  D7411: CoverageTier.Basic,      // Excision of benign lesion — greater than 1.25 cm
  D7412: CoverageTier.Basic,      // Excision of benign lesion — complicated
  D7413: CoverageTier.Basic,      // Excision of malignant lesion — up to 1.25 cm
  D7414: CoverageTier.Basic,      // Excision of malignant lesion — greater than 1.25 cm
  D7415: CoverageTier.Basic,      // Excision of malignant lesion — complicated
  D7440: CoverageTier.Basic,      // Excision of malignant tumor — up to 1.25 cm
  D7441: CoverageTier.Basic,      // Excision of malignant tumor — greater than 1.25 cm
  D7450: CoverageTier.Major,      // Removal of benign odontogenic cyst or tumor — up to 1.25 cm
  D7451: CoverageTier.Major,      // Removal of benign odontogenic cyst or tumor — greater than 1.25 cm
  D7460: CoverageTier.Major,      // Removal of benign nonodontogenic cyst or tumor — up to 1.25 cm
  D7461: CoverageTier.Major,      // Removal of benign nonodontogenic cyst or tumor — greater than 1.25 cm
  D7465: CoverageTier.Major,      // Destruction of lesion(s) by physical or chemical method
  D7471: CoverageTier.Major,      // Removal of lateral exostosis
  D7472: CoverageTier.Major,      // Removal of torus palatinus
  D7473: CoverageTier.Major,      // Removal of torus mandibularis
  D7485: CoverageTier.Major,      // Reduction of osseous tuberosity
  D7490: CoverageTier.Major,      // Surgical repositioning of teeth
  D7510: CoverageTier.Basic,      // Incision and drainage of abscess — intraoral soft tissue
  D7511: CoverageTier.Basic,      // Incision and drainage — intraoral soft tissue
  D7520: CoverageTier.Basic,      // Incision and drainage of abscess — extraoral soft tissue
  D7521: CoverageTier.Basic,      // Incision and drainage — extraoral soft tissue
  D7530: CoverageTier.Basic,      // Removal of foreign body from mucosa, skin, subcutaneous alveolar tissue
  D7540: CoverageTier.Basic,      // Removal of reaction-producing foreign bodies — musculoskeletal system
  D7550: CoverageTier.Basic,      // Partial ostectomy/sequestrectomy for removal of non-vital bone
  D7560: CoverageTier.Basic,      // Maxillary sinusotomy for removal of tooth fragment or foreign body
  D7610: CoverageTier.Major,      // Maxilla — open reduction (teeth immobilized)
  D7620: CoverageTier.Major,      // Maxilla — open reduction (teeth not immobilized)
  D7630: CoverageTier.Major,      // Mandible — open reduction (teeth immobilized)
  D7640: CoverageTier.Major,      // Mandible — open reduction (teeth not immobilized)
  D7710: CoverageTier.Major,      // Malar and/or zygomatic arch — closed reduction
  D7720: CoverageTier.Major,      // Malar and/or zygomatic arch — open reduction
  D7730: CoverageTier.Major,      // Nasal bone — closed reduction
  D7740: CoverageTier.Major,      // Nasal bone — open reduction
  D7750: CoverageTier.Major,      // Orbit — open reduction
  D7760: CoverageTier.Major,      // Orbit — open reduction (multiple sites)
  D7770: CoverageTier.Major,      // Alveolus — stabilization of teeth, closed reduction (splinting)
  D7771: CoverageTier.Major,      // Alveolus — stabilization of teeth (open reduction, splinting)
  D7780: CoverageTier.Major,      // Facial bones — complicated reduction with fixation
  D7810: CoverageTier.Major,      // Open reduction of dislocation
  D7820: CoverageTier.Major,      // Closed reduction of dislocation
  D7830: CoverageTier.Major,      // Manipulation under anesthesia
  D7840: CoverageTier.Major,      // Condylectomy
  D7850: CoverageTier.Major,      // Surgical discectomy with/without implant
  D7852: CoverageTier.Major,      // Disc repair
  D7854: CoverageTier.Major,      // Synovectomy
  D7856: CoverageTier.Major,      // Myotomy
  D7858: CoverageTier.Major,      // Osteotomy — temporomandibular joint
  D7860: CoverageTier.Major,      // Arthrotomy
  D7865: CoverageTier.Major,      // Arthroplasty
  D7870: CoverageTier.Major,      // Arthrocentesis
  D7872: CoverageTier.Major,      // Arthroscopy — diagnosis, with or without biopsy
  D7873: CoverageTier.Major,      // Arthroscopy — surgical, disk repositioning and stabilization
  D7874: CoverageTier.Major,      // Arthroscopy — surgical, synovectomy
  D7875: CoverageTier.Major,      // Arthroscopy — surgical, capsular shrinkage
  D7876: CoverageTier.Major,      // Arthroscopy — surgical, discectomy
  D7877: CoverageTier.Major,      // Arthroscopy — surgical, debridement
  D7880: CoverageTier.Major,      // Occlusal orthotic device (TMJ)
  D7881: CoverageTier.Major,      // Occlusal orthotic device adjustment
  D7899: CoverageTier.Major,      // Unspecified TMD therapy
  D7910: CoverageTier.Basic,      // Suture of recent small wounds — up to 5 cm
  D7911: CoverageTier.Basic,      // Complicated suture — up to 5 cm
  D7912: CoverageTier.Basic,      // Complicated suture — greater than 5 cm
  D7920: CoverageTier.Basic,      // Skin graft (identify defect covered, location, size, graft type)
  D7940: CoverageTier.Major,      // Osteoplasty — for orthognathic deformities
  D7941: CoverageTier.Major,      // Osteotomy — mandibular rami
  D7943: CoverageTier.Major,      // Osteotomy — mandibular rami with bone graft
  D7944: CoverageTier.Major,      // Osteotomy — segmented or subapical — per segment
  D7945: CoverageTier.Major,      // Osteotomy — body of mandible
  D7946: CoverageTier.Major,      // LeFort I (maxilla — total)
  D7947: CoverageTier.Major,      // LeFort I (maxilla — segmented)
  D7948: CoverageTier.Major,      // LeFort II or LeFort III
  D7949: CoverageTier.Major,      // LeFort II or LeFort III with bone graft
  D7950: CoverageTier.Major,      // Osseous, osteoperiosteal, or cartilage graft
  D7951: CoverageTier.Major,      // Sinus augmentation with bone or bone substitute
  D7952: CoverageTier.Major,      // Sinus augmentation via a lateral open approach
  D7953: CoverageTier.Major,      // Bone replacement graft for ridge preservation
  D7955: CoverageTier.Major,      // Repair of maxillofacial soft and hard tissue defects
  D7960: CoverageTier.Major,      // Frenulectomy — also known as frenectomy or frenotomy
  D7961: CoverageTier.Major,      // Buccal and/or labial frenectomy or frenotomy
  D7962: CoverageTier.Major,      // Lingual frenectomy or frenotomy
  D7970: CoverageTier.Basic,      // Excision of hyperplastic tissue — per arch
  D7971: CoverageTier.Basic,      // Excision of pericoronal gingiva
  D7972: CoverageTier.Basic,      // Surgical reduction of fibrous tuberosity
  D7979: CoverageTier.Basic,      // Non-surgical sialolithotomy
  D7980: CoverageTier.Basic,      // Surgical sialolithotomy
  D7981: CoverageTier.Basic,      // Excision of salivary gland
  D7982: CoverageTier.Basic,      // Sialodochoplasty
  D7983: CoverageTier.Basic,      // Closure of salivary fistula
  D7990: CoverageTier.Basic,      // Emergency tracheotomy
  D7991: CoverageTier.Basic,      // Coronoidectomy
  D7995: CoverageTier.Major,      // Synthetic graft — mandible or facial bones (excluding alveolar ridge)
  D7996: CoverageTier.Major,      // Implant — mandible for augmentation purposes (excluding alveolar ridge)
  D7997: CoverageTier.Major,      // Appliance removal (not by dentist who placed appliance) — includes removal of arch bars
  D7999: CoverageTier.Basic,      // Unspecified oral surgery procedure

  // ─────────────────────────────────────────────────────────────
  // D8000–D8999 — Orthodontics
  // ─────────────────────────────────────────────────────────────
  D8010: CoverageTier.Ortho,      // Limited orthodontic treatment — primary dentition
  D8020: CoverageTier.Ortho,      // Limited orthodontic treatment — transitional dentition
  D8030: CoverageTier.Ortho,      // Limited orthodontic treatment — adolescent dentition
  D8040: CoverageTier.Ortho,      // Limited orthodontic treatment — adult dentition
  D8050: CoverageTier.Ortho,      // Interceptive orthodontic treatment — primary dentition
  D8060: CoverageTier.Ortho,      // Interceptive orthodontic treatment — transitional dentition
  D8070: CoverageTier.Ortho,      // Comprehensive orthodontic treatment — transitional dentition
  D8080: CoverageTier.Ortho,      // Comprehensive orthodontic treatment — adolescent dentition
  D8090: CoverageTier.Ortho,      // Comprehensive orthodontic treatment — adult dentition
  D8210: CoverageTier.Ortho,      // Removable appliance therapy
  D8220: CoverageTier.Ortho,      // Fixed appliance therapy
  D8660: CoverageTier.Ortho,      // Pre-orthodontic examination
  D8670: CoverageTier.Ortho,      // Periodic orthodontic treatment visit
  D8680: CoverageTier.Ortho,      // Orthodontic retention (removal of appliances, construction and placement of retainer)
  D8681: CoverageTier.Ortho,      // Removable orthodontic retainer adjustment
  D8695: CoverageTier.Ortho,      // Removal of fixed orthodontic appliances for reasons other than completion of treatment
  D8696: CoverageTier.Ortho,      // Repair of orthodontic appliance — maxillary
  D8697: CoverageTier.Ortho,      // Repair of orthodontic appliance — mandibular
  D8698: CoverageTier.Ortho,      // Re-cement or re-bond fixed retainer — maxillary
  D8699: CoverageTier.Ortho,      // Re-cement or re-bond fixed retainer — mandibular
  D8701: CoverageTier.Ortho,      // Repair of fixed retainer, includes reattachment — maxillary
  D8702: CoverageTier.Ortho,      // Repair of fixed retainer, includes reattachment — mandibular
  D8703: CoverageTier.Ortho,      // Replacement of lost or broken retainer — maxillary
  D8704: CoverageTier.Ortho,      // Replacement of lost or broken retainer — mandibular
  D8999: CoverageTier.Ortho,      // Unspecified orthodontic procedure

  // ─────────────────────────────────────────────────────────────
  // D9000–D9999 — Adjunctive Services
  // ─────────────────────────────────────────────────────────────
  D9110: CoverageTier.Basic,      // Emergency treatment of the dental pulp
  D9120: CoverageTier.Basic,      // Fixed partial denture sectioning
  D9130: CoverageTier.Basic,      // Temporomandibular joint dysfunction (TMJD) — basic
  D9210: CoverageTier.Basic,      // Local anesthesia — not in conjunction with operative
  D9211: CoverageTier.Basic,      // Regional block anesthesia
  D9212: CoverageTier.Basic,      // Trigeminal division block anesthesia
  D9215: CoverageTier.Basic,      // Local anesthesia — in conjunction with operative procedures
  D9220: CoverageTier.Basic,      // Deep sedation/general anesthesia — initial 15 min
  D9221: CoverageTier.Basic,      // Deep sedation/general anesthesia — each additional 15 min
  D9230: CoverageTier.Basic,      // Inhalation of nitrous oxide — anxiolysis, analgesia
  D9239: CoverageTier.Basic,      // Intravenous moderate (conscious) sedation — initial 15 min
  D9243: CoverageTier.Basic,      // Intravenous moderate (conscious) sedation — each additional 15 min
  D9248: CoverageTier.Basic,      // Non-intravenous conscious sedation
  D9310: CoverageTier.Basic,      // Consultation — diagnostic service
  D9311: CoverageTier.Basic,      // Consultation with a medical health care professional
  D9410: CoverageTier.Preventive, // House/extended care facility call
  D9420: CoverageTier.Preventive, // Hospital or ambulatory surgical center call
  D9430: CoverageTier.Preventive, // Office visit for observation (no work performed)
  D9440: CoverageTier.Basic,      // Office visit — after regularly scheduled hours
  D9450: CoverageTier.Basic,      // Case presentation
  D9510: CoverageTier.Basic,      // Therapeutic drug injection, by report
  D9512: CoverageTier.Basic,      // Therapeutic drug injection (1 to 10 ml)
  D9610: CoverageTier.Basic,      // Injection of therapeutic drug
  D9612: CoverageTier.Basic,      // Injection of therapeutic drug (single drug)
  D9613: CoverageTier.Basic,      // Injection of therapeutic drug (multiple drug)
  D9630: CoverageTier.Basic,      // Drugs or medicaments dispensed in the office
  D9910: CoverageTier.Basic,      // Application of desensitizing medicament
  D9911: CoverageTier.Basic,      // Application of desensitizing resin for cervical and/or root surface
  D9920: CoverageTier.Basic,      // Behavior management — each 15-min increment
  D9930: CoverageTier.Basic,      // Treatment of complications (post-surgical) — unusual circumstances
  D9932: CoverageTier.Basic,      // Cleaning and inspection of removable complete denture
  D9933: CoverageTier.Basic,      // Cleaning and inspection of removable partial denture
  D9934: CoverageTier.Basic,      // Cleaning and inspection of removable complete denture and partial denture
  D9935: CoverageTier.Basic,      // Occlusal adjustment — limited
  D9951: CoverageTier.Major,      // Occlusal adjustment — complete
  D9952: CoverageTier.Major,      // Occlusal adjustment — limited (by report)
  D9970: CoverageTier.Preventive, // Enamel microabrasion
  D9971: CoverageTier.Basic,      // Odontoplasty — per tooth
  D9972: CoverageTier.Basic,      // External bleaching — per arch, take-home trays
  D9973: CoverageTier.Basic,      // In-office bleaching — per arch
  D9974: CoverageTier.Basic,      // Internal bleaching — per tooth
  D9975: CoverageTier.Basic,      // External bleaching for home application, per arch; fabricated by dentist
  D9986: CoverageTier.Basic,      // Missed appointment
  D9987: CoverageTier.Basic,      // Cancelled appointment
  D9990: CoverageTier.Basic,      // Certified translation or sign-language services
  D9991: CoverageTier.Basic,      // Dental case management
  D9992: CoverageTier.Basic,      // Dental case management — patient education to improve oral health literacy
  D9993: CoverageTier.Basic,      // Dental case management — motivational interviewing
  D9994: CoverageTier.Basic,      // Dental case management — patient coordination
  D9995: CoverageTier.Basic,      // Teledentistry — synchronous; real-time encounter
  D9996: CoverageTier.Basic,      // Teledentistry — asynchronous; information stored and forwarded
};

/**
 * Get coverage tier for a CDT code.
 * Tries exact match first, then falls back to range-based inference.
 */
export function getCoverageTier(cdtCode: string): CoverageTier {
  const normalized = cdtCode.toUpperCase().trim();

  // Exact match
  if (normalized in CDT_CODE_MAP) {
    return CDT_CODE_MAP[normalized];
  }

  // Range-based fallback for unlisted codes
  const num = parseInt(normalized.substring(1), 10);
  if (isNaN(num)) return CoverageTier.Basic;

  if (num >= 100 && num <= 999) return CoverageTier.Preventive;   // D0100–D0999 Diagnostic
  if (num >= 1000 && num <= 1999) return CoverageTier.Preventive; // D1000–D1999 Preventive
  if (num >= 2000 && num <= 2399) return CoverageTier.Basic;      // D2000–D2399 Basic restorative
  if (num >= 2400 && num <= 2999) return CoverageTier.Major;      // D2400–D2999 Major restorative
  if (num >= 3000 && num <= 3999) return CoverageTier.Basic;      // D3000–D3999 Endo
  if (num >= 4000 && num <= 4999) return CoverageTier.Basic;      // D4000–D4999 Perio
  if (num >= 5000 && num <= 5899) return CoverageTier.Major;      // D5000–D5899 Removable prostho
  if (num >= 5900 && num <= 5999) return CoverageTier.Major;      // Maxillofacial prosthetics
  if (num >= 6000 && num <= 6999) return CoverageTier.Major;      // D6000–D6999 Implants + fixed prostho
  if (num >= 7000 && num <= 7999) return CoverageTier.Basic;      // D7000–D7999 Oral surgery
  if (num >= 8000 && num <= 8999) return CoverageTier.Ortho;      // D8000–D8999 Ortho
  if (num >= 9000 && num <= 9999) return CoverageTier.Basic;      // D9000–D9999 Adjunctive

  return CoverageTier.Basic; // ultimate fallback
}

export { CDT_CODE_MAP };
