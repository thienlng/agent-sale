# Optional Hermes bridge (services/hermes) for running bots on a ChatGPT-plan login, for testing
# only (see services/hermes/README.md). The Hermes runtime is not in this repo: the build context
# is a staging folder holding `hermes-agent/` (the pinned Hermes source) and `bridge/`
# (services/hermes). Enabled on the server with COMPOSE_PROFILES=hermes; never published.
FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
RUN useradd --uid 10001 --create-home hermes && install -d -o hermes -g hermes -m 700 /data
COPY hermes-agent /opt/hermes-agent
# Hermes refuses wheel builds; it runs from source as an editable install (as in development).
RUN pip install --no-cache-dir -e /opt/hermes-agent
COPY bridge /opt/bridge
WORKDIR /opt/bridge
USER hermes
ENV HERMES_BRIDGE_HOST=0.0.0.0 RAPIZ_HERMES_HOME=/data/hermes-home PYTHONUNBUFFERED=1 \
    PYTHONPATH=/opt/hermes-agent
EXPOSE 8788
CMD ["python", "bridge.py"]
