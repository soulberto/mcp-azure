# Historical Releases v1.0.0 - v2.3.5

Esta release consolida todas las versiones históricas del MCP Azure DevOps desde su creación inicial.

## 📋 Versiones Incluidas

- **v1.0.0**: Initial MCP Azure DevOps server with basic Work Items functionality
  - Commit: 1a562fd
  - Cambios: Implementación inicial del servidor MCP con Azure DevOps Work Items

- **v1.1.0**: [Remoto - cambios no disponibles en repo local]

- **v2.0.0**: Major update with Azure Repos, Pull Requests, and complete Git integration
  - Commit: 5ca5ae3
  - Cambios: Integración completa con Azure Repos y Pull Requests
  - Features:
    - Gestión de repositorios Git
    - Pull Requests completas (crear, actualizar, completar, abandonar)
    - Reviews y comentarios en PRs
    - Información de commits y work items vinculados

- **v2.1.0**: [Remoto - cambios no disponibles en repo local]

- **v2.1.1**: Error handling improvements for list_areas and list_iterations tools
  - Commit: 4a06090
  - Cambios: Mejoras en manejo de errores para list_areas y list_iterations

- **v2.1.2**: Fix for including attachment names when linking to Work Items
  - Commit: 9d36d7a
  - Cambios: Corrección para incluir nombres de adjuntos al vincular con Work Items

- **v2.2.0**: OpenCode configuration documentation and examples
  - Commit: 2bfdda5
  - Cambios: Documentación de configuración en OpenCode

- **v2.3.0 - v2.3.5**: [Remotos - múltiples correcciones y mejoras]

## 🔧 Características Principales (v2.3.5)

### Azure DevOps Integration
- ✅ Work Items completos (User Stories, Bugs, Tasks)
- ✅ Consultas WIQL personalizadas
- ✅ Sprints y áreas del proyecto
- ✅ Adjuntos y comentarios

### Git Integration
- ✅ Repositorios Git completos
- ✅ Pull Requests completos (CRUD)
- ✅ Reviews y votos en PRs
- ✅ Commits y work items vinculados

### Configuración
- ✅ Variables de entorno
- ✅ Claude Desktop compatible
- ✅ OpenCode compatible
- ✅ MCP estándar

### Estabilidad
- ✅ Manejo básico de errores
- ✅ Validación de parámetros
- ✅ Mensajes de error informativos

## 📈 Evolución del Proyecto

El proyecto evolucionó desde un servidor MCP básico hasta una solución completa de integración con Azure DevOps que incluye:

1. **Fase 1 (v1.x)**: Funcionalidad básica de Work Items
2. **Fase 2 (v2.0-v2.2.x)**: Integración con Git y mejoras en documentación
3. **Fase 3 (v2.3.x)**: Correcciones de errores y mejoras de estabilidad

## 🚀 Instalación

```bash
npm install @slorenzot/mcp-azure@2.3.5
```

## 📚 Documentación

- README.md con ejemplos completos
- OPENCODE_SETUP.md para configuración en OpenCode
- Ejemplos de configuración para Claude Desktop

---

*Esta release consolida el histórico de desarrollo del proyecto desde su creación hasta v2.3.5.*