// El video completo: las escenas en fila, la pista de sonido y, en cada corte grande, el barrido de los seis colores.
import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { Ademas, Atlas, Cierre, Dojo, Intro, Puente, Sensei, Transformer } from './escenas';
import { Barrido } from './piezas';
import { C } from './tema';
import T from './tiempos.json';

const COMPONENTES: Record<string, React.FC> = { intro: Intro, transformer: Transformer, atlas: Atlas, puente: Puente, sensei: Sensei, dojo: Dojo, ademas: Ademas, cierre: Cierre };
export const DURACION = T.escenas.reduce((s, e) => s + e.dur, 0);

export const Portada: React.FC<{ sonido?: boolean }> = ({ sonido = true }) => {
  let t = 0;
  const piezas: React.ReactNode[] = [];
  T.escenas.forEach((e, i) => {
    const Escena = COMPONENTES[e.id];
    piezas.push(<Sequence key={'e' + i} from={t} durationInFrames={e.dur}><Escena /></Sequence>);
    if (e.barrido) piezas.push(<Sequence key={'b' + i} from={t - T.barrido / 2} durationInFrames={T.barrido}><Barrido dur={T.barrido} /></Sequence>);
    t += e.dur;
  });
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {piezas}
      {sonido && <Audio src={staticFile('sonido.wav')} />}
    </AbsoluteFill>
  );
};
