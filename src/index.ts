#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as azdev from "azure-devops-node-api";
import * as witApi from "azure-devops-node-api/WorkItemTrackingApi";
import * as witInterfaces from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import * as coreApi from "azure-devops-node-api/CoreApi";
import * as VSSInterfaces from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";

// ============================================
// VARIABLES DE ENTORNO
// ============================================
const ENV_ADO_ORG = process.env.AZURE_DEVOPS_ORG || process.env.ADO_ORG;
const ENV_ADO_PAT = process.env.AZURE_DEVOPS_PAT || process.env.ADO_PAT;
const ENV_ADO_PROJECT = process.env.AZURE_DEVOPS_PROJECT || process.env.ADO_PROJECT;

// Variable para almacenar el PAT actual (para llamadas REST directas)
let currentPat: string = ENV_ADO_PAT || "";
let currentOrg: string = ENV_ADO_ORG || "";

// Helper para subir attachment via REST API
async function uploadAttachmentRest(
  filePath: string,
  fileName: string
): Promise<{ url: string; id: string }> {
  const fileContent = fs.readFileSync(filePath);

  // Construir URL del API - asegurar que no haya doble slash
  const baseUrl = currentOrg.endsWith("/") ? currentOrg.slice(0, -1) : currentOrg;
  const encodedProject = encodeURIComponent(currentProject);
  const encodedFileName = encodeURIComponent(fileName);
  const fullUrl = `${baseUrl}/${encodedProject}/_apis/wit/attachments?fileName=${encodedFileName}&api-version=7.0`;

  const urlObj = new URL(fullUrl);

  const options: https.RequestOptions = {
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": fileContent.length,
      "Authorization": `Basic ${Buffer.from(`:${currentPat}`).toString("base64")}`,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const result = JSON.parse(data);
            resolve({ url: result.url, id: result.id });
          } catch (e) {
            reject(new Error(`Error parsing response: ${data}`));
          }
        } else {
          reject(new Error(`Error uploading attachment: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on("error", (e) => reject(new Error(`Request error: ${e.message}`)));
    req.write(fileContent);
    req.end();
  });
}

// Crear el servidor MCP
const server = new McpServer({
  name: "mcp-azure",
  version: "1.0.0",
});

// Configuración de conexión
let connection: azdev.WebApi | null = null;
let workItemTrackingApi: witApi.IWorkItemTrackingApi | null = null;
let coreApiClient: coreApi.ICoreApi | null = null;
let currentProject: string = "";

// Helper para obtener la conexión
async function getConnection(): Promise<azdev.WebApi> {
  if (!connection) {
    throw new Error(
      `No hay conexión configurada con Azure DevOps.

Configura las siguientes variables de entorno:
  - AZURE_DEVOPS_ORG (o ADO_ORG): URL de la organización (ej: https://dev.azure.com/mi-org)
  - AZURE_DEVOPS_PAT (o ADO_PAT): Personal Access Token
  - AZURE_DEVOPS_PROJECT (o ADO_PROJECT): Nombre del proyecto (opcional)

Para obtener un PAT:
  1. Ve a tu organización de Azure DevOps
  2. Haz clic en tu avatar > Personal Access Tokens
  3. Crea un nuevo token con permisos de Work Items (Read & Write)

Ejemplo de configuración MCP:
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
}`
    );
  }
  return connection;
}

// Helper para obtener Work Item Tracking API
async function getWitApi(): Promise<witApi.IWorkItemTrackingApi> {
  if (!workItemTrackingApi) {
    const conn = await getConnection();
    workItemTrackingApi = await conn.getWorkItemTrackingApi();
  }
  return workItemTrackingApi;
}

// Helper para obtener Core API
async function getCoreApi(): Promise<coreApi.ICoreApi> {
  if (!coreApiClient) {
    const conn = await getConnection();
    coreApiClient = await conn.getCoreApi();
  }
  return coreApiClient;
}

// Helper para formatear Work Item
function formatWorkItem(workItem: witInterfaces.WorkItem): string {
  const fields = workItem.fields || {};
  return JSON.stringify(
    {
      id: workItem.id,
      rev: workItem.rev,
      url: workItem.url,
      fields: {
        title: fields["System.Title"],
        state: fields["System.State"],
        workItemType: fields["System.WorkItemType"],
        assignedTo: fields["System.AssignedTo"]?.displayName,
        areaPath: fields["System.AreaPath"],
        iterationPath: fields["System.IterationPath"],
        description: fields["System.Description"],
        tags: fields["System.Tags"],
        createdDate: fields["System.CreatedDate"],
        changedDate: fields["System.ChangedDate"],
      },
    },
    null,
    2
  );
}

// Helper para formatear lista de Work Items
function formatWorkItemList(
  workItems: witInterfaces.WorkItemReference[]
): string {
  return workItems
    .map((wi) => `ID: ${wi.id} - URL: ${wi.url}`)
    .join("\n");
}

// ============================================
// HERRAMIENTAS DE AZURE DEVOPS - AUTENTICACIÓN
// ============================================

// Configurar Azure DevOps con PAT
server.tool(
  "ado_configure",
  "Configura la conexión a Azure DevOps con token de acceso personal (PAT).",
  {
    organization: z
      .string()
      .describe("URL de la organización (ej: https://dev.azure.com/mi-org)"),
    project: z.string().describe("Nombre del proyecto"),
    pat: z
      .string()
      .describe("Token de acceso personal (PAT) de Azure DevOps"),
  },
  async ({ organization, project, pat }) => {
    const authHandler = azdev.getPersonalAccessTokenHandler(pat);
    connection = new azdev.WebApi(organization, authHandler);
    workItemTrackingApi = null;
    coreApiClient = null;
    currentProject = project;
    currentPat = pat;
    currentOrg = organization;

    // Verificar conexión
    try {
      const connData = await connection.connect();
      return {
        content: [
          {
            type: "text",
            text: `Conexión establecida exitosamente.\n- Organización: ${organization}\n- Proyecto: ${project}\n- Usuario autenticado: ${connData.authenticatedUser?.providerDisplayName || "N/A"}`,
          },
        ],
      };
    } catch (error: any) {
      connection = null;
      throw new Error(`Error al conectar: ${error.message}`);
    }
  }
);

// ============================================
// HERRAMIENTAS DE AZURE DEVOPS WORK ITEMS
// ============================================

// Obtener un Work Item por ID
server.tool(
  "ado_get_work_item",
  "Obtiene un Work Item de Azure DevOps por su ID",
  {
    id: z.number().describe("El ID del Work Item"),
    full: z
      .boolean()
      .optional()
      .describe("Si es true, devuelve todos los campos"),
  },
  async ({ id, full }) => {
    const api = await getWitApi();
    const expand = full
      ? witInterfaces.WorkItemExpand.All
      : witInterfaces.WorkItemExpand.Fields;
    const workItem = await api.getWorkItem(id, undefined, undefined, expand);

    if (!workItem) {
      throw new Error(`Work Item con ID ${id} no encontrado`);
    }

    const result = full
      ? JSON.stringify(workItem, null, 2)
      : formatWorkItem(workItem);

    return {
      content: [{ type: "text", text: result }],
    };
  }
);

// Consultar Work Items por Sprint
server.tool(
  "ado_query_sprint",
  "Consulta User Stories de un sprint específico en Azure DevOps",
  {
    iterationPath: z
      .string()
      .describe("Ruta del sprint (ej: 'Proyecto\\Sprint1')"),
    state: z
      .string()
      .optional()
      .describe("Filtrar por estado (Active, New, Closed, etc.)"),
  },
  async ({ iterationPath, state }) => {
    const api = await getWitApi();
    const stateFilter = state ? ` AND [System.State] = '${state}'` : "";
    const wiql: witInterfaces.Wiql = {
      query: `SELECT [System.Id], [System.Title], [System.State], [System.Tags] FROM WorkItems WHERE [System.WorkItemType] = 'User Story'${stateFilter} AND [System.IterationPath] UNDER '${iterationPath}' ORDER BY [System.Id]`,
    };

    const teamContext = { project: currentProject };
    const queryResult = await api.queryByWiql(wiql, teamContext);
    const workItemRefs = queryResult.workItems || [];

    if (workItemRefs.length === 0) {
      return {
        content: [
          { type: "text", text: "No se encontraron Work Items en este sprint" },
        ],
      };
    }

    // Obtener detalles de los Work Items
    const ids = workItemRefs.map((wi) => wi.id!).filter((id): id is number => id !== undefined);
    const workItems = await api.getWorkItems(
      ids,
      ["System.Id", "System.Title", "System.State", "System.Tags"]
    );

    const result = workItems
      .map((wi) => {
        const fields = wi.fields || {};
        return `ID: ${wi.id} | ${fields["System.Title"]} | Estado: ${fields["System.State"]} | Tags: ${fields["System.Tags"] || "N/A"}`;
      })
      .join("\n");

    return {
      content: [{ type: "text", text: result || "Sin resultados" }],
    };
  }
);

// Consultar Work Items por Área
server.tool(
  "ado_query_area",
  "Consulta User Stories de un área específica en Azure DevOps",
  {
    areaPath: z.string().describe("Ruta del área (ej: 'Proyecto\\Equipo')"),
    workItemType: z
      .string()
      .optional()
      .describe("Tipo de Work Item (User Story, Bug, Task, etc.)"),
  },
  async ({ areaPath, workItemType }) => {
    const api = await getWitApi();
    const type = workItemType || "User Story";
    const wiql: witInterfaces.Wiql = {
      query: `SELECT [System.Id], [System.Title], [System.State], [System.Tags] FROM WorkItems WHERE [System.WorkItemType] = '${type}' AND [System.AreaPath] UNDER '${areaPath}' ORDER BY [System.Id] DESC`,
    };

    const teamContext = { project: currentProject };
    const queryResult = await api.queryByWiql(wiql, teamContext);
    const workItemRefs = queryResult.workItems || [];

    if (workItemRefs.length === 0) {
      return {
        content: [
          { type: "text", text: "No se encontraron Work Items en esta área" },
        ],
      };
    }

    const ids = workItemRefs.map((wi) => wi.id!).filter((id): id is number => id !== undefined);
    const workItems = await api.getWorkItems(
      ids,
      ["System.Id", "System.Title", "System.State", "System.Tags"]
    );

    const result = workItems
      .map((wi) => {
        const fields = wi.fields || {};
        return `ID: ${wi.id} | ${fields["System.Title"]} | Estado: ${fields["System.State"]} | Tags: ${fields["System.Tags"] || "N/A"}`;
      })
      .join("\n");

    return {
      content: [{ type: "text", text: result || "Sin resultados" }],
    };
  }
);

// Ejecutar query WIQL personalizado
server.tool(
  "ado_query_wiql",
  "Ejecuta una consulta WIQL personalizada en Azure DevOps",
  {
    wiql: z.string().describe("Query WIQL completa"),
    getDetails: z
      .boolean()
      .optional()
      .describe("Si es true, obtiene los detalles completos de cada Work Item"),
  },
  async ({ wiql, getDetails }) => {
    const api = await getWitApi();
    const wiqlQuery: witInterfaces.Wiql = { query: wiql };

    const teamContext = { project: currentProject };
    const queryResult = await api.queryByWiql(wiqlQuery, teamContext);
    const workItemRefs = queryResult.workItems || [];

    if (workItemRefs.length === 0) {
      return {
        content: [{ type: "text", text: "No se encontraron resultados" }],
      };
    }

    if (!getDetails) {
      return {
        content: [{ type: "text", text: formatWorkItemList(workItemRefs) }],
      };
    }

    const ids = workItemRefs.map((wi) => wi.id!).filter((id): id is number => id !== undefined);
    const workItems = await api.getWorkItems(ids);

    const result = workItems.map((wi) => formatWorkItem(wi)).join("\n---\n");

    return {
      content: [{ type: "text", text: result }],
    };
  }
);

// Obtener campos de un tipo de Work Item
server.tool(
  "ado_get_work_item_type_fields",
  "Obtiene los campos disponibles y requeridos para un tipo de Work Item",
  {
    workItemType: z
      .string()
      .describe("Tipo de Work Item (User Story, Bug, Task, etc.)"),
  },
  async ({ workItemType }) => {
    const api = await getWitApi();

    const fields = await api.getWorkItemTypeFieldsWithReferences(
      currentProject,
      workItemType
    );

    const result = fields.map((field) => {
      const required = field.alwaysRequired ? "REQUERIDO" : "opcional";
      const allowedValues = field.allowedValues?.length
        ? `\n     Valores permitidos: ${field.allowedValues.join(", ")}`
        : "";
      const defaultValue = field.defaultValue
        ? `\n     Valor por defecto: ${field.defaultValue}`
        : "";
      return `- ${field.referenceName} (${required})${allowedValues}${defaultValue}`;
    });

    return {
      content: [
        {
          type: "text",
          text: `Campos para "${workItemType}":\n\n${result.join("\n")}`,
        },
      ],
    };
  }
);

// Crear un Work Item
server.tool(
  "ado_create_work_item",
  "Crea un nuevo Work Item en Azure DevOps. Usa ado_get_work_item_type_fields para ver campos requeridos.",
  {
    title: z.string().describe("Título del Work Item"),
    type: z
      .string()
      .describe("Tipo de Work Item (User Story, Bug, Task, etc.)"),
    description: z.string().optional().describe("Descripción del Work Item"),
    areaPath: z.string().optional().describe("Ruta del área"),
    iterationPath: z.string().optional().describe("Ruta del sprint/iteración"),
    assignedTo: z.string().optional().describe("Usuario asignado"),
    fields: z
      .record(z.string(), z.string())
      .optional()
      .describe("Campos adicionales como objeto {nombreCampo: valor}. Ej: {'Custom.OKR': 'valor'}"),
  },
  async ({ title, type, description, areaPath, iterationPath, assignedTo, fields }) => {
    const api = await getWitApi();

    const patchDocument: VSSInterfaces.JsonPatchOperation[] = [
      {
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.Title",
        value: title,
      },
    ];

    if (description) {
      patchDocument.push({
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.Description",
        value: description,
      });
    }

    if (areaPath) {
      patchDocument.push({
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.AreaPath",
        value: areaPath,
      });
    }

    if (iterationPath) {
      patchDocument.push({
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.IterationPath",
        value: iterationPath,
      });
    }

    if (assignedTo) {
      patchDocument.push({
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.AssignedTo",
        value: assignedTo,
      });
    }

    // Agregar campos personalizados
    if (fields) {
      for (const [fieldName, value] of Object.entries(fields)) {
        patchDocument.push({
          op: VSSInterfaces.Operation.Add,
          path: `/fields/${fieldName}`,
          value: value,
        });
      }
    }

    const workItem = await api.createWorkItem(
      null,
      patchDocument,
      currentProject,
      type
    );

    return {
      content: [
        {
          type: "text",
          text: `Work Item creado exitosamente:\n${formatWorkItem(workItem)}`,
        },
      ],
    };
  }
);

// Actualizar un Work Item
server.tool(
  "ado_update_work_item",
  "Actualiza un Work Item existente en Azure DevOps",
  {
    id: z.number().describe("ID del Work Item a actualizar"),
    title: z.string().optional().describe("Nuevo título"),
    state: z
      .string()
      .optional()
      .describe("Nuevo estado (New, Active, Closed, etc.)"),
    assignedTo: z.string().optional().describe("Usuario asignado"),
    description: z.string().optional().describe("Nueva descripción"),
    fields: z
      .record(z.string(), z.string())
      .optional()
      .describe("Campos adicionales como objeto {campo: valor}"),
  },
  async ({ id, title, state, assignedTo, description, fields }) => {
    const api = await getWitApi();

    const patchDocument: VSSInterfaces.JsonPatchOperation[] = [];

    if (title) {
      patchDocument.push({
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.Title",
        value: title,
      });
    }

    if (state) {
      patchDocument.push({
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.State",
        value: state,
      });
    }

    if (assignedTo) {
      patchDocument.push({
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.AssignedTo",
        value: assignedTo,
      });
    }

    if (description) {
      patchDocument.push({
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.Description",
        value: description,
      });
    }

    if (fields) {
      for (const [field, value] of Object.entries(fields)) {
        patchDocument.push({
          op: VSSInterfaces.Operation.Add,
          path: `/fields/${field}`,
          value: value,
        });
      }
    }

    if (patchDocument.length === 0) {
      throw new Error("Debe proporcionar al menos un campo para actualizar");
    }

    const workItem = await api.updateWorkItem(
      null,
      patchDocument,
      id
    );

    return {
      content: [
        {
          type: "text",
          text: `Work Item actualizado exitosamente:\n${formatWorkItem(workItem)}`,
        },
      ],
    };
  }
);

// Listar iteraciones/sprints
server.tool(
  "ado_list_iterations",
  "Lista las iteraciones/sprints disponibles en el proyecto",
  {},
  async () => {
    const api = await getWitApi();
    const iterations = await api.getClassificationNode(
      currentProject,
      witInterfaces.TreeStructureGroup.Iterations,
      undefined,
      10
    );

    function formatIterations(
      node: witInterfaces.WorkItemClassificationNode,
      indent: string = ""
    ): string {
      let result = `${indent}${node.name}`;
      if (node.attributes) {
        const startDate = node.attributes["startDate"];
        const finishDate = node.attributes["finishDate"];
        if (startDate || finishDate) {
          result += ` (${startDate ? new Date(startDate).toLocaleDateString() : "?"} - ${finishDate ? new Date(finishDate).toLocaleDateString() : "?"})`;
        }
      }
      result += "\n";

      if (node.children) {
        for (const child of node.children) {
          result += formatIterations(child, indent + "  ");
        }
      }
      return result;
    }

    const result = formatIterations(iterations);

    return {
      content: [{ type: "text", text: result }],
    };
  }
);

// Listar áreas del proyecto
server.tool(
  "ado_list_areas",
  "Lista las áreas disponibles en el proyecto",
  {},
  async () => {
    const api = await getWitApi();
    const areas = await api.getClassificationNode(
      currentProject,
      witInterfaces.TreeStructureGroup.Areas,
      undefined,
      10
    );

    function formatAreas(
      node: witInterfaces.WorkItemClassificationNode,
      indent: string = ""
    ): string {
      let result = `${indent}${node.name}\n`;
      if (node.children) {
        for (const child of node.children) {
          result += formatAreas(child, indent + "  ");
        }
      }
      return result;
    }

    const result = formatAreas(areas);

    return {
      content: [{ type: "text", text: result }],
    };
  }
);

// ============================================
// HERRAMIENTAS DE DISCUSIONES / COMENTARIOS
// ============================================

// Agregar comentario a un Work Item
server.tool(
  "ado_add_comment",
  "Agrega un comentario/entrada de discusión a un Work Item. Soporta formato Markdown.",
  {
    id: z.number().describe("ID del Work Item"),
    comment: z.string().describe("Texto del comentario (soporta Markdown)"),
  },
  async ({ id, comment }) => {
    const api = await getWitApi();

    // Usar System.History para agregar comentario
    const patchDocument: VSSInterfaces.JsonPatchOperation[] = [
      {
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.History",
        value: comment,
      },
    ];

    await api.updateWorkItem(null, patchDocument, id);

    return {
      content: [
        {
          type: "text",
          text: `Comentario agregado exitosamente al Work Item #${id}`,
        },
      ],
    };
  }
);

// Obtener comentarios de un Work Item
server.tool(
  "ado_get_comments",
  "Obtiene los comentarios/historial de discusión de un Work Item",
  {
    id: z.number().describe("ID del Work Item"),
    top: z.number().optional().describe("Número máximo de comentarios a obtener (por defecto 10)"),
  },
  async ({ id, top = 10 }) => {
    const api = await getWitApi();

    const comments = await api.getComments(currentProject, id, top);

    if (!comments.comments || comments.comments.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No hay comentarios en el Work Item #${id}`,
          },
        ],
      };
    }

    const result = comments.comments
      .map((comment) => {
        const author = comment.createdBy?.displayName || "Desconocido";
        const date = comment.createdDate
          ? new Date(comment.createdDate).toLocaleString()
          : "Fecha desconocida";
        const text = comment.text || "(sin contenido)";
        return `**${author}** - ${date}\n${text}\n`;
      })
      .join("\n---\n");

    return {
      content: [
        {
          type: "text",
          text: `Comentarios del Work Item #${id}:\n\n${result}`,
        },
      ],
    };
  }
);

// ============================================
// HERRAMIENTAS DE ADJUNTOS / ATTACHMENTS
// ============================================

// Subir un archivo como adjunto
server.tool(
  "ado_upload_attachment",
  "Sube un archivo como adjunto a Azure DevOps y devuelve la URL del adjunto",
  {
    filePath: z.string().describe("Ruta completa del archivo a subir"),
    fileName: z.string().optional().describe("Nombre del archivo (opcional, se usa el nombre del archivo si no se especifica)"),
  },
  async ({ filePath, fileName }) => {
    if (!currentPat || !currentOrg) {
      throw new Error("No hay conexión configurada. Usa ado_configure primero.");
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`El archivo no existe: ${filePath}`);
    }

    const name = fileName || path.basename(filePath);
    const attachment = await uploadAttachmentRest(filePath, name);

    return {
      content: [
        {
          type: "text",
          text: `Archivo subido exitosamente:\n- Nombre: ${name}\n- URL: ${attachment.url}\n- ID: ${attachment.id}\n\nUsa esta URL con ado_add_attachment para vincular el adjunto a un Work Item.`,
        },
      ],
    };
  }
);

// Agregar adjunto a un Work Item existente
server.tool(
  "ado_add_attachment",
  "Agrega un adjunto a un Work Item existente. Puede subir un archivo nuevo o vincular uno ya subido.",
  {
    workItemId: z.number().describe("ID del Work Item"),
    filePath: z.string().optional().describe("Ruta del archivo a subir (opcional si se usa attachmentUrl)"),
    attachmentUrl: z.string().optional().describe("URL de un adjunto ya subido (opcional si se usa filePath)"),
    comment: z.string().optional().describe("Comentario para el adjunto"),
  },
  async ({ workItemId, filePath, attachmentUrl, comment }) => {
    const api = await getWitApi();

    let url = attachmentUrl;

    // Si se proporciona un archivo, subirlo primero usando REST API
    if (filePath) {
      if (!currentPat || !currentOrg) {
        throw new Error("No hay conexión configurada. Usa ado_configure primero.");
      }

      if (!fs.existsSync(filePath)) {
        throw new Error(`El archivo no existe: ${filePath}`);
      }

      const fileName = path.basename(filePath);
      const attachment = await uploadAttachmentRest(filePath, fileName);
      url = attachment.url;
    }

    if (!url) {
      throw new Error("Debe proporcionar filePath o attachmentUrl");
    }

    // Vincular el adjunto al Work Item
    const patchDocument: VSSInterfaces.JsonPatchOperation[] = [
      {
        op: VSSInterfaces.Operation.Add,
        path: "/relations/-",
        value: {
          rel: "AttachedFile",
          url: url,
          attributes: {
            comment: comment || "",
          },
        },
      },
    ];

    await api.updateWorkItem(null, patchDocument, workItemId);

    return {
      content: [
        {
          type: "text",
          text: `Adjunto agregado exitosamente al Work Item #${workItemId}\n- URL: ${url}`,
        },
      ],
    };
  }
);

// Obtener adjuntos de un Work Item
server.tool(
  "ado_get_attachments",
  "Obtiene la lista de adjuntos de un Work Item",
  {
    id: z.number().describe("ID del Work Item"),
  },
  async ({ id }) => {
    const api = await getWitApi();

    const workItem = await api.getWorkItem(
      id,
      undefined,
      undefined,
      witInterfaces.WorkItemExpand.Relations
    );

    if (!workItem.relations || workItem.relations.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No hay adjuntos en el Work Item #${id}`,
          },
        ],
      };
    }

    const attachments = workItem.relations
      .filter((rel) => rel.rel === "AttachedFile")
      .map((rel) => {
        const comment = rel.attributes?.comment || "";
        const name = rel.attributes?.name || "Sin nombre";
        return `- ${name}\n  URL: ${rel.url}\n  Comentario: ${comment || "(sin comentario)"}`;
      });

    if (attachments.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No hay adjuntos en el Work Item #${id}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Adjuntos del Work Item #${id}:\n\n${attachments.join("\n\n")}`,
        },
      ],
    };
  }
);

// ============================================
// PROMPTS DE MCP PARA IA
// ============================================

// Prompt para iniciar sesión en Azure DevOps
server.prompt(
  "connect",
  "Inicia sesión en Azure DevOps usando un Personal Access Token (PAT).",
  {
    organization: z
      .string()
      .describe("URL de la organización (ej: https://dev.azure.com/mi-org)"),
    project: z.string().optional().describe("Nombre del proyecto"),
    pat: z.string().describe("Personal Access Token (PAT)"),
  },
  async ({ organization, project, pat }) => {
    let instructions = `Conectando a Azure DevOps...

**Datos de conexión:**
- Organización: ${organization}
- Proyecto: ${project || "(no especificado)"}
- PAT: ****${pat.slice(-4)}

`;

    if (!project) {
      instructions += `Por favor proporciona el nombre del proyecto para continuar.

Una vez tengas el proyecto, ejecuta:
\`ado_configure(organization="${organization}", project="TU_PROYECTO", pat="${pat}")\``;
    } else {
      instructions += `Ejecuta la herramienta ado_configure para establecer la conexión:
\`ado_configure(organization="${organization}", project="${project}", pat="${pat}")\``;
    }

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: instructions,
          },
        },
      ],
    };
  }
);

// Prompt para analizar un sprint
server.prompt(
  "analyze_sprint",
  "Analiza el estado actual de un sprint y proporciona un resumen",
  {
    iterationPath: z.string().describe("Ruta del sprint a analizar"),
  },
  async ({ iterationPath }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Por favor analiza el sprint "${iterationPath}" en Azure DevOps:

1. Primero, usa la herramienta ado_query_sprint para obtener todas las User Stories del sprint
2. Cuenta cuántas están en cada estado (New, Active, Closed, etc.)
3. Identifica si hay User Stories bloqueadas o en riesgo
4. Proporciona un resumen ejecutivo del progreso del sprint
5. Sugiere acciones si hay problemas

Usa las herramientas de Azure DevOps disponibles para obtener la información necesaria.`,
          },
        },
      ],
    };
  }
);

// Prompt para crear User Story desde descripción
server.prompt(
  "create_user_story",
  "Crea una User Story bien estructurada a partir de una descripción",
  {
    description: z.string().describe("Descripción de la funcionalidad deseada"),
    areaPath: z.string().optional().describe("Área del proyecto"),
    iterationPath: z.string().optional().describe("Sprint destino"),
  },
  async ({ description, areaPath, iterationPath }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Crea una User Story en Azure DevOps basada en esta descripción:

"${description}"

Requisitos:
1. Genera un título conciso y descriptivo
2. Escribe la descripción en formato: "Como [rol], quiero [acción] para [beneficio]"
3. Incluye criterios de aceptación claros
${areaPath ? `4. Asigna al área: ${areaPath}` : ""}
${iterationPath ? `5. Asigna al sprint: ${iterationPath}` : ""}

Usa la herramienta ado_create_work_item para crear la User Story con el contenido generado.`,
          },
        },
      ],
    };
  }
);

// Prompt para reporte diario de trabajo
server.prompt(
  "daily_standup",
  "Genera un reporte de standup diario basado en los work items",
  {
    assignedTo: z.string().describe("Usuario para el reporte"),
  },
  async ({ assignedTo }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Genera un reporte de standup diario para ${assignedTo}:

1. Usa ado_query_wiql para buscar:
   - Work Items activos asignados a "${assignedTo}"
   - Work Items completados recientemente por "${assignedTo}"

2. Organiza el reporte en formato standup:
   - ¿Qué se completó ayer?
   - ¿En qué se está trabajando hoy?
   - ¿Hay algún impedimento?

Consulta WIQL sugerida:
SELECT [System.Id], [System.Title], [System.State], [System.ChangedDate]
FROM WorkItems
WHERE [System.AssignedTo] = '${assignedTo}'
AND [System.State] IN ('Active', 'Closed', 'Resolved')
ORDER BY [System.ChangedDate] DESC`,
          },
        },
      ],
    };
  }
);

// Prompt para planificación de sprint
server.prompt(
  "plan_sprint",
  "Ayuda a planificar un nuevo sprint",
  {
    iterationPath: z.string().describe("Ruta del sprint a planificar"),
    backlogArea: z.string().describe("Área del backlog a revisar"),
  },
  async ({ iterationPath, backlogArea }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Ayúdame a planificar el sprint "${iterationPath}":

1. Primero, lista las iteraciones disponibles con ado_list_iterations
2. Busca User Stories en el backlog (estado New) del área "${backlogArea}" usando ado_query_area
3. Para cada User Story candidata, muestra:
   - ID y Título
   - Estado actual
   - Tags relevantes

4. Sugiere cuáles User Stories priorizar basándote en:
   - Dependencias
   - Complejidad aparente
   - Valor de negocio (si hay tags indicativos)

5. Para las User Stories seleccionadas, puedo moverlas al sprint usando ado_update_work_item`,
          },
        },
      ],
    };
  }
);

// Prompt para buscar y actualizar work items
server.prompt(
  "bulk_update",
  "Actualiza múltiples work items basado en criterios",
  {
    searchCriteria: z.string().describe("Criterios de búsqueda en lenguaje natural"),
    updateAction: z.string().describe("Acción a realizar (ej: cambiar estado, asignar, mover a sprint)"),
  },
  async ({ searchCriteria, updateAction }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Necesito actualizar work items en Azure DevOps:

**Criterios de búsqueda:** ${searchCriteria}
**Acción a realizar:** ${updateAction}

Por favor:
1. Genera una consulta WIQL apropiada para encontrar los work items
2. Ejecuta ado_query_wiql para obtener los IDs
3. Muéstrame la lista de work items que coinciden
4. Pide confirmación antes de actualizar
5. Si confirmo, usa ado_update_work_item para cada uno

IMPORTANTE: Siempre muestra lo que vas a cambiar ANTES de hacerlo y espera mi confirmación.`,
          },
        },
      ],
    };
  }
);

// Prompt para generar reporte de proyecto
server.prompt(
  "project_report",
  "Genera un reporte del estado del proyecto",
  {},
  async () => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Genera un reporte completo del estado del proyecto en Azure DevOps:

1. **Estructura del proyecto:**
   - Usa ado_list_areas para mostrar las áreas
   - Usa ado_list_iterations para mostrar los sprints

2. **Estado por Sprint:**
   - Para cada sprint activo, cuenta work items por estado

3. **Métricas generales:**
   - Total de work items abiertos vs cerrados
   - Work items sin asignar
   - Work items antiguos (más de 30 días sin cambios)

4. **Recomendaciones:**
   - Identifica cuellos de botella
   - Sugiere acciones de mejora

Usa las herramientas disponibles para recopilar esta información.`,
          },
        },
      ],
    };
  }
);

// Prompt para crear bug desde descripción
server.prompt(
  "report_bug",
  "Crea un bug report estructurado a partir de una descripción",
  {
    bugDescription: z.string().describe("Descripción del bug encontrado"),
    severity: z.enum(["1 - Critical", "2 - High", "3 - Medium", "4 - Low"]).optional().describe("Severidad del bug"),
  },
  async ({ bugDescription, severity }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Crea un Bug en Azure DevOps basado en esta descripción:

"${bugDescription}"

Por favor:
1. Genera un título claro y conciso
2. Estructura la descripción con:
   - **Pasos para reproducir**
   - **Comportamiento esperado**
   - **Comportamiento actual**
   - **Ambiente/Contexto**
${severity ? `3. Severidad: ${severity}` : ""}

Usa la herramienta ado_create_work_item con type="Bug" para crear el bug.`,
          },
        },
      ],
    };
  }
);

// ============================================
// RECURSOS DE MCP
// ============================================

// Recurso para información de conexión
server.resource(
  "connection-status",
  "ado://connection/status",
  async () => {
    if (!connection) {
      return {
        contents: [
          {
            uri: "ado://connection/status",
            mimeType: "application/json",
            text: JSON.stringify({ connected: false, message: "No conectado. Usa ado_login o ado_configure." }),
          },
        ],
      };
    }

    try {
      const connData = await connection.connect();
      return {
        contents: [
          {
            uri: "ado://connection/status",
            mimeType: "application/json",
            text: JSON.stringify({
              connected: true,
              project: currentProject,
              user: connData.authenticatedUser?.providerDisplayName || "N/A",
              userId: connData.authenticatedUser?.id,
            }),
          },
        ],
      };
    } catch {
      return {
        contents: [
          {
            uri: "ado://connection/status",
            mimeType: "application/json",
            text: JSON.stringify({ connected: false, message: "Error al verificar conexión" }),
          },
        ],
      };
    }
  }
);

// Función para auto-configurar desde variables de entorno
async function autoConfigureFromEnv(): Promise<void> {
  if (ENV_ADO_ORG && ENV_ADO_PAT) {
    try {
      const authHandler = azdev.getPersonalAccessTokenHandler(ENV_ADO_PAT);
      connection = new azdev.WebApi(ENV_ADO_ORG, authHandler);
      currentProject = ENV_ADO_PROJECT || "";
      currentPat = ENV_ADO_PAT;
      currentOrg = ENV_ADO_ORG;

      const connData = await connection.connect();
      console.error(`Auto-configurado desde variables de entorno:`);
      console.error(`  - Organización: ${ENV_ADO_ORG}`);
      console.error(`  - Proyecto: ${ENV_ADO_PROJECT || "(no especificado)"}`);
      console.error(`  - Usuario: ${connData.authenticatedUser?.providerDisplayName || "N/A"}`);
    } catch (error: any) {
      console.error(`Error al auto-configurar desde variables de entorno: ${error.message}`);
      connection = null;
    }
  }
}

// Función principal para iniciar el servidor
async function main() {
  // Auto-configurar si hay variables de entorno
  await autoConfigureFromEnv();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Servidor MCP Azure DevOps iniciado (usando SDK)");
}

main().catch((error) => {
  console.error("Error al iniciar el servidor:", error);
  process.exit(1);
});
