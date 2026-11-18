"""Lo que comparten las pruebas: un Triton falso, las reglas, la ficha del modelo y fotos hechas al vuelo.

Contrato:
- TritonFalso tiene los mismos métodos asíncronos que el cliente real (get_model_metadata, is_model_ready, infer,
  close) y lanza las mismas excepciones, pero contesta lo que la prueba le pida: logits, una demora, un error, «no
  listo». Además revisa el nombre, el tipo y la forma del tensor que le mandan, como lo haría Triton.
- No abre ningún puerto: las pruebas corren sin Triton, sin GPU y sin red, en segundos.
"""
# Todavía no está escrito (paso 8 del GUION).
