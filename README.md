# @slorenzot/mcp-azure

Servidor MCP (Model Context Protocol) para Azure DevOps. Permite interactuar con Work Items, sprints, áreas, comentarios y adjuntos desde cualquier cliente MCP compatible.

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
