// Tokens de TrueML en tema oscuro (los mismos de apps/trueml/tokens.css).
export const C = {
  bg: '#0A0F22',
  grid: 'rgba(255,255,255,.045)',
  card: '#121A36',
  chip: '#1B2450',
  ink: '#EEF1FB',
  ink2: '#B4BCDD',
  ink3: '#8C95BD',
  line: '#232C52',
  acc: '#8FA2FF',
  y: '#E8AE36',
  yt: '#FFC857',
  o: '#EC6A3F',
  g: '#17B386',
  b: '#3D5AFE',
  p: '#7A69EE',
  n: '#5A6699',
};

// Las seis etapas de la T, de abajo hacia arriba por el tronco y luego la barra.
export const ETAPAS = [
  { id: 'datos', nombre: 'Datos', color: C.y },
  { id: 'modelo', nombre: 'Modelo', color: C.o },
  { id: 'api', nombre: 'API', color: C.g },
  { id: 'contenedor', nombre: 'Contenedor', color: C.b },
  { id: 'orquestacion', nombre: 'Orquestación', color: C.p },
  { id: 'monitoreo', nombre: 'Monitoreo', color: C.n },
] as const;

export const SANS = 'system-ui, -apple-system, "SF Pro Display", "Segoe UI", Roboto, sans-serif';
export const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
export const FPS = 30;
