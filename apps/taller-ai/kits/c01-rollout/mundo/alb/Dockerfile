# La imagen del «ALB» del dojo (mundo/alb/alb.py): solo la biblioteca estándar. La construye mundo/crear.py.
FROM python:3.13-slim
COPY alb.py /app/alb.py
USER nobody
EXPOSE 8080 8081
CMD ["python", "-u", "/app/alb.py"]
