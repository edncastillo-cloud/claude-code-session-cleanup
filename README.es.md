# Claude Code Session Cleanup de Edwin Castillo

Autor: Edwin Castillo · [Read in English](README.md)

Un marketplace de plugins para Claude Code. Se agrega una vez y se instalan los plugins que se quieran.

```
/plugin marketplace add edncastillo-cloud/claude-plugins
/plugin install session-cleanup@edwin-castillo
```

## session-cleanup

Claude Code de escritorio mantiene vivo un proceso `claude.exe` (~220 MB) más sus servidores MCP por cada sesión que no has archivado. Una docena de sesiones ociosas retiene fácilmente 3–4 GB. `session-cleanup` muestra a dónde se va esa memoria y la libera, siempre preguntando antes.

**Qué hace**

- **Diagnostica la memoria por sesión**: días desde tu última petición, MB del árbol de procesos de cada sesión y cuánto liberaría cada umbral de archivado.
- **Mide la inactividad por tu última petición, no por el foco.** Hacer clic en una sesión del sidebar revive su proceso y reinicia el contador de archivado de la app, así que el ajuste nativo por sí solo puede mantener vivas sesiones ociosas durante semanas. La skill muestra cuáles nunca archivaría la app sola.
- **Archiva las sesiones que marques** (con `archive_session`, que no las vuelve a abrir) y fija `auto_archive_inactive_days` en los días que elijas.
- **Cierra procesos huérfanos**: servidores MCP y shells de herramientas cuya sesión ya murió. Los reconoce por tus MCP configurados (`~/.claude.json`, `.mcp.json` de cada proyecto, configuración de escritorio y plugins) y por los shell snapshots de Claude Code. Todo lo que contenga un servidor de desarrollo (`ng serve`, `vite`, `webpack`, `esbuild`, `next dev`, `dotnet watch`, `nodemon`) queda protegido y nunca se cierra.
- **Reporta la memoria liberada real** frente a la estimada.

**Uso**: pídele a Claude Code algo como *"libera memoria de mis sesiones de Claude"*, o ejecuta `/session-cleanup:session-cleanup`. Responde en tu idioma.

**Requisitos**: Windows, app de escritorio de Claude Code y Node.js.

**Límites**

- Lee los metadatos de sesión de la app (`%APPDATA%\Claude\claude-code-sessions`), un formato interno y no documentado. Una actualización de la app puede cambiarlo; si ya no se puede leer, la skill lo dice y reporta solo la memoria de los procesos.
- Solo Windows: usa `Win32_Process` y `taskkill`.
- Nada se archiva ni se cierra sin tu confirmación, y nunca se borran sesiones.

## Licencia

MIT
