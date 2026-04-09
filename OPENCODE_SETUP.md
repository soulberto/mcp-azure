# Azure DevOps MCP - Configuración en OpenCode

## ¿Qué es este servidor MCP?

El servidor MCP (Model Context Protocol) para Azure DevOps permite interactuar con Work Items, repositorios Git, Pull Requests, sprints, áreas, comentarios y adjuntos desde OpenCode.

## Instalación

```bash
npm install -g @slorenzot/mcp-azure
```

O usar directamente con npx:

```bash
npx @slorenzot/mcp-azure
```

## Configuración en OpenCode

OpenCode puede usar este servidor MCP de dos formas:

### Opción 1: Configuración inicial con variables de entorno

1. **Agrega el servidor MCP a tu configuración de OpenCode:**

   Edita tu archivo de configuración de OpenCode (usualmente en `~/.opencode/config.json` o similar) y agrega:

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

2. **Configura las variables de entorno en tu sistema (alternativa):**

   ```bash
   export AZURE_DEVOPS_ORG="https://dev.azure.com/tu-organizacion"
   export AZURE_DEVOPS_PAT="tu-pat-aqui"
   export AZURE_DEVOPS_PROJECT="tu-proyecto"
   ```

### Opción 2: Configuración dinámica con `ado_configure`

Esta opción es útil para cambiar entre diferentes organizaciones o proyectos sin modificar el archivo de configuración.

**Desde OpenCode, usa el comando:**

```json
{
  "organization": "https://dev.azure.com/tu-organizacion",
  "project": "tu-proyecto",
  "pat": "tu-pat-aqui"
}
```

Esta conexión persiste durante la sesión actual de OpenCode.

## Obtener un Personal Access Token (PAT)

1. Ve a tu organización de Azure DevOps (ej: https://dev.azure.com/SuratechDevOpsColombia)
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
| `ado_list_pull_requests` | Lista Pull Requests con filtros opcionales |
| `ado_get_pull_request` | Obtiene detalles completos de un Pull Request |
| `ado_create_pull_request` | Crea un nuevo Pull Request |
| `ado_update_pull_request` | Actualiza propiedades de un Pull Request |
| `ado_complete_pull_request` | Completa (merge) un Pull Request |
| `ado_abandon_pull_request` | Abandona un Pull Request |

### Pull Request Reviews

| Herramienta | Descripción |
|-------------|-------------|
| `ado_approve_pull_request` | Aprueba un Pull Request |
| `ado_reject_pull_request` | Rechaza un Pull Request |
| `ado_get_pull_request_reviewers` | Obtiene todos los revisores y sus votos |
| `ado_add_pull_request_reviewer` | Agrega un revisor a un Pull Request |

### Comentarios y Discusiones

| Herramienta | Descripción |
|-------------|-------------|
| `ado_add_comment` | Agrega un comentario a un Work Item (soporta Markdown) |
| `ado_get_comments` | Obtiene los comentarios de un Work Item |

### Adjuntos

| Herramienta | Descripción |
|-------------|-------------|
| `ado_upload_attachment` | Sube un archivo y devuelve la URL del adjunto |
| `ado_add_attachment` | Agrega un adjunto a un Work Item (con nombre personalizado) |
| `ado_get_attachments` | Lista los adjuntos de un Work Item |

## Ejemplos de Uso en OpenCode

### Crear una User Story

```json
{
  "title": "Implementar login con OAuth",
  "type": "User Story",
  "description": "Como usuario quiero poder iniciar sesión con mi cuenta de Google",
  "areaPath": "MiProyecto\\Backend",
  "iterationPath": "MiProyecto\\Sprint 5"
}
```

### Adjuntar un archivo con nombre personalizado

```json
{
  "workItemId": 12345,
  "filePath": "/ruta/al/archivo.pdf",
  "comment": "Documento de especificaciones",
  "name": "Especificaciones Funcionales v2.0"
}
```

### Aprobar un Pull Request

```json
{
  "pullRequestId": 12345,
  "repositoryId": "mi-repo"
}
```

## Ventajas de Usar MCP en OpenCode

1. **Integración directa**: No necesitas salir de OpenCode para interactuar con Azure DevOps
2. **Configuración flexible**: Puedes cambiar entre diferentes organizaciones/proyectos fácilmente
3. **Automatización**: Permite automatizar tareas repetitivas de Work Items y Pull Requests
4. **Contexto completo**: OpenCode puede leer el contexto de tu proyecto para crear Work Items más precisos

## Soporte

- **GitHub**: https://github.com/slorenzot/mcp-azure
- **Issues**: Reporta problemas en el repositorio de GitHub
- **Documentación completa**: Ver el README del proyecto en GitHub

## Versión

**2.4.1** - 34 herramientas disponibles para Azure DevOps
