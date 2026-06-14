// Agent Launchpad MCP Server — Cloudflare Worker
// Exposes the Launchpad directory API as MCP tools

const LAUNCHPAD_API = "https://launchpad.smartbizcalc.com";
const SERVER_INFO = { name: "launchpad-mcp", version: "1.0.0" };

const TOOLS = [
  {
    name: "list_ai_agents",
    description: "Browse the Agent Launchpad — a curated directory of AI agents, tools, frameworks, and workflows built by indie builders. Returns paginated listings with upvote counts.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["all", "agent", "tool", "framework", "workflow"],
          description: "Filter by project type. Default: all.",
          default: "all",
        },
        sort: {
          type: "string",
          enum: ["recent", "popular", "trending"],
          description: "Sort: recent (newest), popular (most upvotes all-time), trending (upvotes in last 48h). Default: recent.",
          default: "recent",
        },
        page: { type: "number", description: "Page number (20 results per page). Default: 1.", default: 1 },
      },
    },
  },
  {
    name: "get_featured_agents",
    description: "Get the top 10 currently featured AI agents and tools on the Agent Launchpad homepage, sorted by upvote count.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_agent_details",
    description: "Get full details for a specific listing in the Agent Launchpad directory, including description, tags, pricing model, upvotes, and comments.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The listing ID from list_ai_agents or get_featured_agents results." },
      },
      required: ["id"],
    },
  },
];

async function runTool(name, args) {
  if (name === "list_ai_agents") {
    const { type = "all", sort = "recent", page = 1 } = args;
    const params = new URLSearchParams({ sort, page: String(page) });
    if (type && type !== "all") params.set("type", type);
    const res = await fetch(`${LAUNCHPAD_API}/api/listings?${params}`);
    if (!res.ok) return { error: `Launchpad API error: ${res.status}` };
    const data = await res.json();
    return {
      listings: (data.listings || []).map(l => ({
        id: l.id,
        name: l.name,
        one_liner: l.one_liner,
        type: l.project_type,
        pricing: l.pricing_model,
        upvotes: l.upvote_count,
        url: l.cta_url,
        tags: l.tags,
        published: l.publish_at,
      })),
      page: data.page,
      per_page: data.per_page,
    };
  }

  if (name === "get_featured_agents") {
    const res = await fetch(`${LAUNCHPAD_API}/api/listings/featured`);
    if (!res.ok) return { error: `Launchpad API error: ${res.status}` };
    const data = await res.json();
    return {
      featured: (data.listings || []).map(l => ({
        id: l.id,
        name: l.name,
        one_liner: l.one_liner,
        type: l.project_type,
        pricing: l.pricing_model,
        upvotes: l.upvote_count,
        url: l.cta_url,
      })),
    };
  }

  if (name === "get_agent_details") {
    const { id } = args;
    const res = await fetch(`${LAUNCHPAD_API}/api/listings/${encodeURIComponent(id)}`);
    if (res.status === 404) return { error: "Listing not found." };
    if (!res.ok) return { error: `Launchpad API error: ${res.status}` };
    const data = await res.json();
    const l = data.listing;
    return {
      id: l.id,
      name: l.name,
      one_liner: l.one_liner,
      type: l.project_type,
      pricing: l.pricing_model,
      upvotes: l.upvote_count,
      url: l.cta_url,
      tags: l.tags,
      badges: l.badges,
      oss_link: l.oss_link,
      published: l.publish_at,
      comments: (data.comments || []).map(c => ({ body: c.body, pinned: c.is_pinned, at: c.created_at })),
    };
  }

  return { error: `Unknown tool: ${name}` };
}

function handleMCP(req) {
  const { id, method, params } = req;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: "Agent Launchpad MCP exposes a curated directory of AI agents, tools, frameworks, and workflows. Use list_ai_agents to browse, get_featured_agents for the homepage highlights, and get_agent_details for full info on a specific listing.",
      },
    };
  }

  if (method === "notifications/initialized") {
    return { jsonrpc: "2.0", id };
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    // runTool is async — return a promise that resolves to the response
    return runTool(name, args || {}).then(result => ({
      jsonrpc: "2.0", id,
      result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
    })).catch(e => ({
      jsonrpc: "2.0", id,
      error: { code: -32603, message: String(e) },
    }));
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

function withCORS(res) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return withCORS(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);

    if (url.pathname === "/") {
      return withCORS(new Response(JSON.stringify({
        name: "Agent Launchpad MCP Server",
        description: "Browse and discover AI agents, tools, and frameworks from the Agent Launchpad directory",
        mcp_endpoint: `${url.origin}/mcp`,
        tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
      }, null, 2), { headers: { "Content-Type": "application/json" } }));
    }

    if (url.pathname !== "/mcp" || request.method !== "POST") {
      return withCORS(new Response("Not found", { status: 404 }));
    }

    try {
      const body = await request.json();
      const response = handleMCP(body);
      // handleMCP may return a Promise for tools/call
      const resolved = await Promise.resolve(response);
      return withCORS(new Response(JSON.stringify(resolved), {
        headers: { "Content-Type": "application/json" },
      }));
    } catch (e) {
      return withCORS(new Response(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
      }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
  },
};
