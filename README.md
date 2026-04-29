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

### Configuración con `.mcp.json`

El servidor también puede leer credenciales desde un archivo `.mcp.json`, buscándolo en este orden:

1. Directorio actual
2. Directorio padre
3. Directorio del script
4. Home del usuario

Ejemplo:

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

### Configuración en OpenCode

OpenCode utiliza el mismo MCP, pero la configuración se puede hacer de dos formas:

#### Opción 1: Configuración inicial con variables de entorno

1. Configura las variables de entorno en tu sistema o en tu configuración de OpenCode:
   ```bash
   export AZURE_DEVOPS_ORG="https://dev.azure.com/tu-organizacion"
   export AZURE_DEVOPS_PAT="tu-pat-aqui"
   export AZURE_DEVOPS_PROJECT="tu-proyecto"
   ```

2. O agrega el servidor MCP en tu configuración de OpenCode:
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

#### Opción 2: Configuración dinámica con `ado_configure`

OpenCode permite configurar la conexión directamente durante la sesión usando el comando `ado_configure`:

```json
{
  "organization": "https://dev.azure.com/tu-organizacion",
  "project": "tu-proyecto",
  "pat": "tu-pat-aqui"
}
```

Esta opción es útil para cambiar entre diferentes organizaciones o proyectos sin modificar el archivo de configuración.

**Nota**: Cuando usas `ado_configure`, la conexión persiste durante la sesión actual de OpenCode.

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
| `ado_delete_work_item` | Elimina un Work Item en Azure DevOps (soft delete por defecto) |
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
| `ado_delete_attachment` | Elimina un adjunto de un Work Item removiendo su relación |
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
  "comment": "Documento de especificaciones",
  "name": "Especificaciones Funcionales v2.0"
}
```

### Vincular Adjunto Existente

```json
{
  "workItemId": 12345,
  "attachmentUrl": "https://dev.azure.com/org/proj/_apis/wit/attachments/abc123",
  "comment": "Diseño de arquitectura",
  "name": "Arquitectura del Sistema"
}
```

### Eliminar Adjunto de un Work Item

```json
{
  "workItemId": 12345,
  "attachmentUrl": "https://dev.azure.com/org/proj/_apis/wit/attachments/abc123",
  "comment": "Adjunto agregado por error"
}
```

### Eliminar una User Story

```json
{
  "id": 12345,
  "confirm": true,
  "destroy": false,
  "expectedType": "User Story"
}
```

`ado_delete_work_item` exige `confirm: true`. Si envías `destroy: true`, la eliminación es permanente.

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

**2.7.0** - 36 herramientas disponibles para Azure DevOps (Work Items, Repositorios Git, Pull Requests, sprints, áreas, comentarios y adjuntos)
