# Remote job worker (§7.5): job-worker's handlers on another host. Register it in Settings → Workers, then:
#   docker build -t textus-worker -f deploy/worker.Dockerfile https://github.com/ernsoylu/Textus.git#main
#   docker run -d --name textus-worker --restart unless-stopped -e TEXTUS_URL=... -e TEXTUS_WORKER_TOKEN=... textus-worker
FROM denoland/deno:alpine-2.9.7
WORKDIR /app
COPY supabase/functions ./functions
USER deno
RUN deno cache --config functions/deno.jsonc functions/job-worker/standalone.ts
# Larger than the 150 MB Edge limit, so PDFs the Edge worker cannot index in one range fit here.
ENV JOB_WORKER_MEMORY_MB=1024
CMD ["run", "--config", "functions/deno.jsonc", "--allow-net", "--allow-env", "--allow-read", "--cached-only", "functions/job-worker/standalone.ts"]
