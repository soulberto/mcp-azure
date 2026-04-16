# Guía de Codificación URL para Azure DevOps MCP

## ¿Cuándo se necesita codificar el nombre del proyecto?

El MCP maneja automáticamente la codificación URL. Aquí están las reglas:

### Operaciones que REQUIEREN codificación (automática):

1. **📎 Adjuntos de archivos**
   - `ado_upload_attachment()`
   - `ado_add_attachment()`
   - Razón: Estas funciones construyen URLs REST manualmente

### Operaciones que NO requieren codificación (automática):

1. **📋 Work Items**
   - Crear/actualizar Work Items
   - Consultas WIQL
   - Tipos de Work Item

2. **🌐 Git Operations**
   - Pull Requests
   - Repositorios
   - Branches

3. **📅 Proyecto Configuration**
   - Iteraciones/Sprints
   - Áreas

## Ejemplos de Nombres de Proyecto

```json
{
  "mcpServers": {
    "azure-devops": {
      "env": {
        "AZURE_DEVOPS_PROJECT": "Mi Proyecto"  // Se codificará automáticamente a "Mi%20Proyecto"
      }
    }
  }
}
```

## Mensajes del Sistema

Cuando el MCP se inicia, verás mensajes como:

```
✅ Conexión establecida exitosamente:
  - Organización: https://dev.azure.com/mi-org
  - Proyecto: "Mi Proyecto"
  - Fuente: .mcp.json
  - Requiere codificación URL: SÍ
  - Versión codificada: "Mi%20Proyecto"
  - NOTA: Solo se usa en operaciones REST manuales (adjuntos)
```

## Configuración Recomendada

### Opción 1: Archivo .mcp.json (Recomendado)

```json
{
  "mcpServers": {
    "azure-devops": {
      "command": "npx",
      "args": ["-y", "@slorenzot/mcp-azure"],
      "env": {
        "AZURE_DEVOPS_ORG": "https://dev.azure.com/tu-organizacion",
        "AZURE_DEVOPS_PAT": "tu-pat-aqui",
        "AZURE_DEVOPS_PROJECT": "Nombre con espacios"
      }
    }
  }
}
```

### Opción 2: Variables de Entorno (Fallback)

```bash
export AZURE_DEVOPS_ORG="https://dev.azure.com/tu-organizacion"
export AZURE_DEVOPS_PAT="tu-pat-aqui"
export AZURE_DEVOPS_PROJECT="Nombre con espacios"
```

## Solución de Problemas

### Errores Comunes

1. **"No se encontró configuración"**
   - Crea un archivo .mcp.json o configura variables de entorno

2. **"Proyecto requiere codificación URL"**
   - Es normal, el MCP lo maneja automáticamente

3. **"Timeout de conexión"**
   - Verifica tu conexión a internet y el PAT

### Jerarquía de Configuración

El MCP busca configuración en este orden:

1. **.mcp.json** en directorio actual
2. **.mcp.json** en directorio padre
3. **.mcp.json** en directorio del script
4. **.mcp.json** en home del usuario
5. **Variables de entorno** (fallback)
6. **Error** si nada está disponible

## Notas Técnicas

- La codificación URL solo se aplica a operaciones REST manuales
- El SDK de Azure DevOps maneja la codificación automáticamente
- Los nombres de proyecto con espacios, #, %, u otros caracteres especiales se codifican automáticamente
- El logging muestra exactamente cuándo y cómo se aplica la codificación