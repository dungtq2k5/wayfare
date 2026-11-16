# Sourced by each feature's system.sh, before its first flow: the local stack's five backend
# services ready (their ops ports' /health/ready), so no flow meets a service still starting.
# A stack that isn't up within two minutes fails the script.
for port in 3101 3102 3103 3104 3105; do
  waited=0
  until curl -sf "http://localhost:$port/health/ready" > /dev/null 2>&1; do
    if [ "$waited" -ge 120 ]; then
      echo "the service on :$port isn't ready after 120 s" >&2
      exit 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
done
