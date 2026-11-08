# Postgres with the backup tools (ADR-028): WAL-G for WAL archiving and base backups, rclone and
# age for the media and config copies. Built on the server by deploy.sh (`docker compose build`).
# WAL-G v3.0.8+ ship no Postgres binaries; v3.0.7 is the newest that does.
FROM pgvector/pgvector:pg16
ARG WALG_VERSION=v3.0.7
ARG WALG_SHA256=a573efb1d874ecfdd773a62cd718eb39adc1b065d27030046ecde9d252b291a4
ARG RCLONE_VERSION=v1.75.2
ARG RCLONE_SHA256=349ac8fba6ff65d6247043f1750cdcb518ec5d500ef91463a10d37c0ccdf3702
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends ca-certificates curl unzip age jq; \
  curl -fsSL -o /tmp/walg.tgz "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-ubuntu-20.04-amd64.tar.gz"; \
  echo "${WALG_SHA256}  /tmp/walg.tgz" | sha256sum -c -; \
  tar -xzf /tmp/walg.tgz -C /tmp; \
  install -m 755 /tmp/wal-g-pg-ubuntu-20.04-amd64 /usr/local/bin/wal-g; \
  curl -fsSL -o /tmp/rclone.zip "https://downloads.rclone.org/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-amd64.zip"; \
  echo "${RCLONE_SHA256}  /tmp/rclone.zip" | sha256sum -c -; \
  unzip -q /tmp/rclone.zip -d /tmp; \
  install -m 755 "/tmp/rclone-${RCLONE_VERSION}-linux-amd64/rclone" /usr/local/bin/rclone; \
  apt-get purge -y unzip; apt-get autoremove -y; rm -rf /tmp/* /var/lib/apt/lists/*; \
  wal-g --version; rclone version | head -1; age --version
# Remotes come from RCLONE_CONFIG_* variables (rapiz-backup); an empty file silences the notice.
RUN touch /etc/rclone.conf
ENV RCLONE_CONFIG=/etc/rclone.conf
COPY --chmod=755 wal-g-archive pg-drill-entrypoint rapiz-backup /usr/local/bin/
