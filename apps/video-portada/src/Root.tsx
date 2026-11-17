import React from 'react';
import { Composition } from 'remotion';
import { DURACION, Portada } from './Portada';
import { REELS } from './reels';

// Portada: 16:9 para la web. Instagram: 9:16 para Reels (mismas escenas, otro acomodo, misma pista).
// Reel-*: los reels cortos de Instagram (src/reels/), uno por herramienta.
export const Root: React.FC = () => (
  <>
    <Composition id="Portada" component={Portada} durationInFrames={DURACION} fps={30} width={1920} height={1080} defaultProps={{ sonido: true }} />
    <Composition id="Instagram" component={Portada} durationInFrames={DURACION} fps={30} width={1080} height={1920} defaultProps={{ sonido: true }} />
    {REELS.map((r) => (
      <Composition key={r.id} id={`Reel-${r.id}`} component={r.componente} durationInFrames={r.dur} fps={30} width={1080} height={1920} defaultProps={{ sonido: true }} />
    ))}
  </>
);
