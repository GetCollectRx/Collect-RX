export interface SyntheticName {
  first: string;
  last: string;
}

/** Twenty obviously fictional names. None is meant to resemble a real person. */
export const SYNTHETIC_NAMES: readonly SyntheticName[] = [
  { first: "Alma", last: "Quillfeather" },
  { first: "Bram", last: "Testwright" },
  { first: "Cora", last: "Fakenworth" },
  { first: "Dexter", last: "Mockingham" },
  { first: "Elowen", last: "Placeholder" },
  { first: "Fennick", last: "Dummerton" },
  { first: "Gwyneth", last: "Notreal" },
  { first: "Hobart", last: "Samplewick" },
  { first: "Isolde", last: "Fiktiv" },
  { first: "Jasper", last: "Makebelieve" },
  { first: "Kestrel", last: "Syntheton" },
  { first: "Lucan", last: "Pretendall" },
  { first: "Marigold", last: "Nonesuch" },
  { first: "Nimbus", last: "Fauxley" },
  { first: "Orla", last: "Simulacrum" },
  { first: "Percival", last: "Stubthwaite" },
  { first: "Rosalind", last: "Fabricant" },
  { first: "Thaddeus", last: "Notaperson" },
  { first: "Ursula", last: "Imaginary" },
  { first: "Wystan", last: "Counterfeit" },
];

/** The six supported carriers, spelled as the import pipeline's carrier map accepts them. */
export const SYNTHETIC_CARRIERS: readonly string[] = [
  "Sun Life",
  "Canada Life",
  "Manulife",
  "Green Shield",
  "RBC",
  "TELUS AdjudiCare",
];

/** Common CDT procedure codes. */
export const SYNTHETIC_PROCEDURE_CODES: readonly string[] = [
  "D0120",
  "D0140",
  "D0210",
  "D0274",
  "D1110",
  "D1206",
  "D2140",
  "D2391",
  "D2750",
  "D3310",
  "D4341",
  "D7140",
];
