/* Transformer Lab · tokenizador de palabras o caracteres (vocabulario construido del corpus). */
(function (root) {
  'use strict';
  const TL = (root.TL = root.TL || {});

  const BOS = '<s>';
  const PUNCT_RE = /([.,;:!?¡¿])/g;
  const ATTACH_LEFT = new Set(['.', ',', ';', ':', '!', '?']); // se pegan a la palabra anterior
  const ATTACH_RIGHT = new Set(['¡', '¿']);                    // se pegan a la palabra siguiente

  // Forma visible de un token: el espacio se muestra como '␣' (modo carácter).
  function displayToken(tok) {
    if (tok === ' ') return '␣';
    if (tok === '\t') return '⇥';
    return tok;
  }

  function splitWords(text) {
    return String(text).toLowerCase().replace(PUNCT_RE, ' $1 ').split(/\s+/).filter(Boolean);
  }

  // Modo carácter: también en minúsculas (vocabulario más pequeño, coherente con el modo palabra);
  // los espacios en blanco consecutivos se reducen a uno.
  function splitChars(text) {
    return Array.from(String(text).toLowerCase().replace(/\s+/g, ' ').trim());
  }

  function build(corpusText, mode, maxLen) {
    mode = mode === 'char' ? 'char' : 'word';
    maxLen = Math.max(1, (maxLen | 0) || 8);
    const split = mode === 'char' ? splitChars : splitWords;
    const lines = String(corpusText || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

    const vocab = [BOS];
    const stoi = Object.create(null);
    stoi[BOS] = 0;
    const lineToks = [];
    for (const line of lines) {
      const toks = split(line);
      if (!toks.length) continue;
      lineToks.push({ text: line, toks });
      for (const t of toks) {
        if (!(t in stoi)) { stoi[t] = vocab.length; vocab.push(t); }
      }
    }
    if (!lineToks.length) throw new Error('El corpus está vacío: escribe al menos una frase (una por línea).');

    const sentences = lineToks.map(({ text, toks }) => {
      const tokens = [BOS].concat(toks).slice(0, maxLen + 1); // se trunca a maxLen + 1 tokens
      const ids = tokens.map((t) => stoi[t]);
      const n = tokens.length;
      return {
        text,
        tokens,
        ids,
        inputIds: ids.slice(0, n - 1),
        targetIds: ids.slice(1),
        inputTokens: tokens.slice(0, n - 1),
        targetTokens: tokens.slice(1),
        T: n - 1,
        truncated: toks.length + 1 > maxLen + 1,
      };
    });

    const tok = {
      mode,
      maxLen,
      vocab,
      stoi,
      bos: BOS,
      sentences,
      split,
      encode(text) {
        const tokens = split(text);
        const ids = [];
        const unknown = [];
        for (const t of tokens) {
          if (t in stoi) ids.push(stoi[t]);
          else {
            ids.push(-1);
            if (unknown.indexOf(t) < 0) unknown.push(t);
          }
        }
        return { ids, tokens, unknown };
      },
      decode(ids) {
        const toks = ids.map((i) => vocab[i]).filter((t) => t !== undefined && t !== BOS);
        if (mode === 'char') return toks.join('');
        let out = '';
        let glueNext = true;
        for (const t of toks) {
          if (ATTACH_LEFT.has(t) || glueNext) out += t;
          else out += ' ' + t;
          glueNext = ATTACH_RIGHT.has(t);
        }
        return out;
      },
      display: displayToken,
      // Mensaje de error en español para tokens desconocidos (útil para la generación).
      unknownMessage(unknown) {
        const shown = vocab.filter((t) => t !== BOS).map(displayToken).join(', ');
        return 'Token' + (unknown.length > 1 ? 's' : '') + ' desconocido' + (unknown.length > 1 ? 's' : '') + ': ' +
          unknown.map((u) => '«' + displayToken(u) + '»').join(', ') +
          '. El modelo solo conoce su vocabulario: ' + shown + '.';
      },
    };
    return tok;
  }

  TL.Tokenizer = { build, displayToken, splitWords, splitChars, BOS };
})(typeof window !== 'undefined' ? window : globalThis);
