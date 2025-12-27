export type Point = [number, number]; // [lng, lat]

export type GraphEdge = {
  segmentGersId: string;
  toConnector: string;
  lengthMeters: number;
  health: number; // 0-100
};

export type Graph = Map<string, GraphEdge[]>; // connector_id -> outgoing edges

export type PathResult = {
  connectorIds: string[];
  segmentGersIds: string[];
  segmentHealths: number[];
  segmentLengths: number[];
  totalDistance: number;
  totalWeightedDistance: number;
};

export type PathWaypoint = {
  coord: Point;
  arrive_at: string; // ISO timestamp
};

export type ConnectorCoords = Map<string, Point>;
