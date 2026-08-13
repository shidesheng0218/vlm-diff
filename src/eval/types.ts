export interface PairRecord {
  id: string;
  fixture: string;
  mutationId: string;
  kind: string;
  magnitude: string;
  selector?: string;
  description: string;
  before: string;
  after: string;
  domBefore: string;
  domAfter: string;
  groundTruthRect?: { x: number; y: number; w: number; h: number };
}
