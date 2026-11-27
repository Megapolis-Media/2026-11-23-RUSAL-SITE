#!/usr/bin/env bash
set -euo pipefail
umask 077

revision=${1:-}
if [[ $# != 1 || ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then
    echo 'Expected the approved master commit SHA.' >&2
    exit 2
fi

root=/srv/rusal-fm
repository=https://github.com/Megapolis-Media/2026-11-23-RUSAL-SITE.git
source_repo=$root/source.git
image=rusal-fm:$revision
previous=
context=
snapshot=
marker=
switch_started=false

compose() {
    local runtime_image=$1
    shift
    RUSAL_IMAGE=$runtime_image docker compose --project-directory "$root" -f "$root/compose.yaml" "$@"
}

finish() {
    local status=$?
    trap - EXIT
    set +e
    if (( status != 0 )) && [[ $switch_started == true ]]; then
        if [[ -n $previous ]]; then
            compose "$previous" up -d --wait --wait-timeout 60 \
                || echo 'Automatic rollback did not become healthy. Inspect the pre-release data snapshot.' >&2
        else
            compose "$image" rm --stop --force web
        fi
    fi
    if [[ -n $context ]]; then rm -rf -- "$context"; fi
    if [[ -n $snapshot ]]; then rm -rf -- "$snapshot"; fi
    if [[ -n $marker ]]; then rm -f -- "$marker"; fi
    exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

exec 9>"$root/.deploy.lock"
flock -w 60 9

git --git-dir="$source_repo" fetch --no-tags --depth=1 "$repository" refs/heads/master
if [[ $(git --git-dir="$source_repo" rev-parse FETCH_HEAD) != "$revision" ]]; then
    echo 'The requested commit is no longer the tip of master.' >&2
    exit 1
fi

previous=$(docker container inspect --format '{{.Config.Image}}' rusal-fm-web-1 2>/dev/null || true)
if [[ -n $previous && ! $previous =~ ^rusal-fm:[0-9a-f]{40}$ ]]; then
    echo 'Unexpected existing RUSAL container image.' >&2
    exit 1
fi

if ! docker image inspect "$image" >/dev/null 2>&1; then
    context=$(mktemp -d "$root/.build.XXXXXX")
    git --git-dir="$source_repo" archive "$revision" | tar -x -C "$context"
    docker build --label "org.opencontainers.image.revision=$revision" --tag "$image" "$context"
fi
[[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") == "$revision" ]]
[[ $(git ls-remote "$repository" refs/heads/master | cut -f1) == "$revision" ]]

switch_started=true
if [[ -n $previous && $previous != "$image" ]]; then
    compose "$previous" stop --timeout 20 web
    snapshot=$(mktemp -d "$root/backups/.pre-release.XXXXXX")
    cp -a --reflink=auto "$root/data/." "$snapshot/"
    mv -T -- "$snapshot" "$root/backups/$(date -u +%Y%m%dT%H%M%SZ)-$revision-${snapshot##*.}"
    snapshot=
fi

compose "$image" up -d --wait --wait-timeout 75
curl --silent --show-error --fail --max-time 10 --output /dev/null http://127.0.0.1:18178/api/config
marker=$(mktemp "$root/.release.XXXXXX")
printf '%s\n' "$revision" > "$marker"
mv -T -- "$marker" "$root/.release"
marker=
switch_started=false
printf 'Released %s\n' "$revision"
