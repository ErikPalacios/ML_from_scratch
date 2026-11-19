import React from 'react';
import { Composition } from 'remotion';
import { Tutorial } from './kit';
import { duracionGuion } from './tiempo';
import { GUIONES } from './guiones';

// Un guion cuyas tomas todavía no se grabaron (le faltan marcas) se salta con un aviso, sin tumbar a los demás.
const listos = GUIONES.flatMap((g) => {
  try { return [{ g, dur: duracionGuion(g) }]; } catch (e) { console.warn(`Tutorial-${g.id}: ${(e as Error).message}`); return []; }
});

/** Las composiciones de los videos explicativos. */
export const Tutoriales: React.FC = () => (
  <>
    {listos.map(({ g, dur }) => (
      <Composition key={g.id} id={`Tutorial-${g.id}`} component={Tutorial} durationInFrames={dur} fps={30} width={1920} height={1080} defaultProps={{ g, sonido: true }} />
    ))}
  </>
);
