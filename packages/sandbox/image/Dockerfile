FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
COPY runner.py transfer.py /opt/fastgpt/
RUN chmod 0555 /opt/fastgpt && chmod 0444 /opt/fastgpt/*.py && mkdir -p /workspace && chown 1000:1000 /workspace
USER 1000:1000
WORKDIR /workspace
ENTRYPOINT []
CMD ["/usr/bin/python3", "-I", "/opt/fastgpt/runner.py", "idle"]
