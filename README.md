# @slorenzot/mcp-azure

Servidor MCP (Model Context Protocol) para Azure DevOps. Permite interactuar con Work Items, repositorios Git, Pull Requests, sprints, áreas, comentarios y adjuntos desde cualquier cliente MCP compatible.

## Instalación

```bash
npm install -g @slorenzot/mcp-azure
```

O usar directamente con npx:

```bash
npx @slorenzot/mcp-azure
```

## Configuración

### Variables de Entorno

El servidor se configura automáticamente usando las siguientes variables de entorno:

| Variable | Alternativa | Descripción | Requerido |
|----------|-------------|-------------|-----------|
| `AZURE_DEVOPS_ORG` | `ADO_ORG` | URL de la organización (ej: `https://dev.azure.com/mi-org`) | Sí |
| `AZURE_DEVOPS_PAT` | `ADO_PAT` | Personal Access Token | Sí |
| `AZURE_DEVOPS_PROJECT` | `ADO_PROJECT` | Nombre del proyecto | No |

### Configuración en Claude Desktop

Agrega la siguiente configuración en tu archivo `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "azure-devops": {
      "command": "npx",
      "args": ["-y", "@slorenzot/mcp-azure"],
      "env": {
        "AZURE_DEVOPS_ORG": "https://dev.azure.com/tu-organizacion",
        "AZURE_DEVOPS_PAT": "tu-pat-aqui",
        "AZURE_DEVOPS_PROJECT": "tu-proyecto"
      }
    }
  }
}
```

### Obtener un Personal Access Token (PAT)

1. Ve a tu organización de Azure DevOps
2. Haz clic en tu avatar (esquina superior derecha)
3. Selecciona **Personal Access Tokens**
4. Crea un nuevo token con los siguientes permisos:
    - **Work Items**: Read & Write
    - **Code**: Read & Write (para operaciones de repositorios y Pull Requests)
    - **Project and Team**: Read (opcional)

## Herramientas Disponibles

### Autenticación

| Herramienta | Descripción |
|-------------|-------------|
| `ado_configure` | Configura la conexión con organización, proyecto y PAT |

### Work Items

| Herramienta | Descripción |
|-------------|-------------|
| `ado_get_work_item` | Obtiene un Work Item por su ID |
| `ado_create_work_item` | Crea un nuevo Work Item (User Story, Bug, Task, etc.) |
| `ado_update_work_item` | Actualiza un Work Item existente |
| `ado_get_work_item_type_fields` | Obtiene los campos disponibles/requeridos de un tipo |

### Consultas

| Herramienta | Descripción |
|-------------|-------------|
| `ado_query_sprint` | Consulta Work Items de un sprint específico |
| `ado_query_area` | Consulta Work Items de un área específica |
| `ado_query_wiql` | Ejecuta una consulta WIQL personalizada |

### Estructura del Proyecto

| Herramienta | Descripción |
|-------------|-------------|
| `ado_list_iterations` | Lista las iteraciones/sprints del proyecto |
| `ado_list_areas` | Lista las áreas del proyecto |

### Repositorios Git

| Herramienta | Descripción |
|-------------|-------------|
| `ado_list_repositories` | Lista todos los repositorios Git del proyecto |
| `ado_get_repository` | Obtiene detalles de un repositorio específico por nombre o ID |
| `ado_list_branches` | Lista las ramas (branches) de un repositorio |

### Pull Requests

| Herramienta | Descripción |
|-------------|-------------|
| `ado_list_pull_requests` | Lista Pull Requests con filtros opcionales (status, branches, creador, revisor) |
| `ado_get_pull_request` | Obtiene detalles completos de un Pull Request |
| `ado_create_pull_request` | Crea un nuevo Pull Request |
| `ado_update_pull_request` | Actualiza propiedades de un Pull Request (título, descripción, draft) |
| `ado_complete_pull_request` | Completa (merge) un Pull Request con estrategia configurable |
| `ado_abandon_pull_request` | Abandona un Pull Request |

### Pull Request Reviews

| Herramienta | Descripción |
|-------------|-------------|
| `ado_approve_pull_request` | Aprueba un Pull Request (voto: 10) |
| `ado_reject_pull_request` | Rechaza un Pull Request (voto: -10) |
| `ado_get_pull_request_reviewers` | Obtiene todos los revisores y sus votos de un Pull Request |
| `ado_add_pull_request_reviewer` | Agrega un revisor a un Pull Request |

### Pull Request Comments

| Herramienta | Descripción |
|-------------|-------------|
| `ado_get_pull_request_threads` | Obtiene todos los hilos de comentarios de un Pull Request |
| `ado_create_pull_request_thread` | Crea un nuevo hilo de comentarios (general o de código) |
| `ado_reply_to_pull_request_thread` | Responde a un hilo de comentarios existente |

### Pull Request Info

| Herramienta | Descripción |
|-------------|-------------|
| `ado_get_pull_request_commits` | Obtiene todos los commits de un Pull Request |
| `ado_get_pull_request_work_items` | Obtiene los Work Items vinculados a un Pull Request |
| `ado_update_pull_request_thread_status` | Actualiza el estado de un hilo de comentarios (Fixed, WontFix, etc.) |

### Comentarios y Discusiones

| Herramienta | Descripción |
|-------------|-------------|
| `ado_add_comment` | Agrega un comentario a un Work Item (soporta Markdown) |
| `ado_get_comments` | Obtiene los comentarios de un Work Item |

### Adjuntos

| Herramienta | Descripción |
|-------------|-------------|
| `ado_upload_attachment` | Sube un archivo y devuelve la URL del adjunto |
| `ado_add_attachment` | Agrega un adjunto a un Work Item |
| `ado_get_attachments` | Lista los adjuntos de un Work Item |

## Ejemplos de Uso

### Crear una User Story

```json
{
  "title": "Implementar login con OAuth",
  "type": "User Story",
  "description": "Como usuario quiero poder iniciar sesión con mi cuenta de Google",
  "areaPath": "MiProyecto\\Backend",
  "iterationPath": "MiProyecto\\Sprint 5",
  "fields": {
    "Custom.OKR": "Seguridad",
    "Custom.Prioridad": "Alta"
  }
}
```

### Consulta WIQL Personalizada

```json
{
  "wiql": "SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.State] = 'Active' AND [System.AssignedTo] = @Me ORDER BY [System.CreatedDate] DESC",
  "getDetails": true
}
```

### Agregar Comentario con Markdown

```json
{
  "id": 12345,
  "comment": "## Análisis completado\n\n- Revisado el código\n- Identificados 3 issues\n\n**Próximo paso:** Corregir validaciones"
}
```

### Subir y Adjuntar Archivo

```json
{
  "workItemId": 12345,
  "filePath": "/ruta/al/archivo.pdf",
  "comment": "Documento de especificaciones"
}
```

### Listar Repositorios

```json
{
  "includeHidden": false,
  "top": 50
}
```

### Listar Pull Requests Activos

```json
{
  "status": "Active",
  "top": 20
}
```

### Crear un Pull Request

```json
{
  "repositoryId": "mi-repo",
  "sourceRefName": "refs/heads/feature-login",
  "targetRefName": "refs/heads/main",
  "title": "Implementar login con OAuth",
  "description": "Esta PR agrega soporte para login con Google OAuth",
  "reviewerIds": ["12345678-1234-1234-1234-1234567890ab"],
  "isDraft": false
}
```

### Aprobar un Pull Request

```json
{
  "pullRequestId": 12345,
  "repositoryId": "mi-repo"
}
```

### Completar (Merge) un Pull Request

```json
{
  "pullRequestId": 12345,
  "repositoryId": "mi-repo",
  "mergeStrategy": "Squash",
  "deleteSourceBranch": true,
  "mergeCommitMessage": "Merge de feature-login"
}
```

### Crear Comentario en Código

```json
{
  "pullRequestId": 12345,
  "repositoryId": "mi-repo",
  "content": "Por favor extraer esto en una función separada",
  "filePath": "/src/components/Login.tsx",
  "startLine": 45,
  "endLine": 52
}
```

## Prompts Disponibles

El servidor incluye prompts predefinidos para facilitar tareas comunes:

| Prompt | Descripción |
|--------|-------------|
| `connect` | Guía para conectarse a Azure DevOps |
| `analyze_sprint` | Analiza el estado de un sprint |
| `create_user_story` | Crea una User Story estructurada |
| `daily_standup` | Genera un reporte de standup diario |
| `plan_sprint` | Ayuda a planificar un sprint |
| `bulk_update` | Actualiza múltiples Work Items |
| `project_report` | Genera un reporte del proyecto |
| `report_bug` | Crea un Bug report estructurado |

## Recursos

| Recurso | URI | Descripción |
|---------|-----|-------------|
| Estado de conexión | `ado://connection/status` | Información del estado de conexión actual |

## Desarrollo

### Requisitos

- Node.js 18+
- npm o yarn

### Instalación local

```bash
git clone https://github.com/slorenzot/mcp-azure.git
cd mcp-azure
npm install
npm run build
```

### Scripts disponibles

```bash
npm run build    # Compila TypeScript
npm run start    # Inicia el servidor
npm run dev      # Modo desarrollo con watch
```

## Licencia

MIT

## Autor

Soulberto Lorenzo - [@slorenzot](https://github.com/slorenzot)

## Versión

**2.4.0** - 34 herramientas disponibles para Azure DevOps (Work Items, Repositorios Git, Pull Requests, etc.)
