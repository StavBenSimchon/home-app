{{- define "home-app.fullname" -}}
{{- printf "%s" (default .Chart.Name .Release.Name) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "home-app.backend.image" -}}
{{- $reg := default "ghcr.io" .Values.global.imageRegistry }}
{{- printf "%s/%s/backend:%s" $reg (default "home-app" (regexFind "[^/]+$" .Values.image.repository)) .Values.image.tag }}
{{- end }}

{{- define "home-app.frontend.image" -}}
{{- $reg := default "ghcr.io" .Values.global.imageRegistry }}
{{- printf "%s/%s/frontend:%s" $reg (default "home-app" (regexFind "[^/]+$" .Values.image.repository)) .Values.image.tag }}
{{- end }}

{{- define "home-app.databaseUrl" -}}
{{- if .Values.postgresql.enabled -}}
postgresql+asyncpg://{{ .Values.postgresql.auth.username }}:{{ .Values.postgresql.auth.password }}@{{ include "home-app.fullname" . }}-postgresql:5432/{{ .Values.postgresql.auth.database }}
{{- else -}}
postgresql+asyncpg://{{ .Values.externalDatabase.username }}:{{ .Values.externalDatabase.password }}@{{ .Values.externalDatabase.host }}:{{ .Values.externalDatabase.port }}/{{ .Values.externalDatabase.database }}
{{- end -}}
{{- end }}
