// The engine owns one mutable conversation; use one serial queue in its worker.
export function createClassifier(engine, tools, describe) {
  const initialized = engine.ccall('needle_init', 'number', ['string', 'string', 'string'], ['', JSON.stringify(tools), null]);
  if (initialized < 0) throw new Error('Needle could not initialize the classification schema.');
  const capacity = 65_536;
  const output = engine._malloc(capacity);
  if (!output) throw new Error('Needle output allocation failed.');
  return {
    classify(candidate) {
      engine._needle_reset();
      engine.HEAPU8[output] = 0;
      const code = engine.ccall('needle_complete', 'number', ['string', 'number', 'number', 'number'], [describe(candidate), 192, output, capacity]);
      if (code < 0) throw new Error('Needle could not complete this candidate.');
      return JSON.parse(engine.UTF8ToString(output));
    },
    dispose() { engine._free(output); },
  };
}
