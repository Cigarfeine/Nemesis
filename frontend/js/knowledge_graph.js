/**
 * Project Nemesis — Knowledge Graph Module (knowledge_graph.js)
 * ================================================================
 * Manages the 3D force-directed NLP Knowledge Graph using 3d-force-graph.
 */

import { NemesisUI } from './ui.js';

export class NemesisKnowledgeGraph {
  constructor(containerId) {
    this._containerId = containerId;
    this._graph = null;
    this._data = { nodes: [], links: [] };
    this._ws = null;
    this._reconnectTimer = null;
  }

  init(globeInstance) {
    const container = document.getElementById(this._containerId);
    if (!container) return;

    // Initialize the 3d-force-graph
    this._graph = ForceGraph3D()(container)
      .width(container.clientWidth)
      .height(container.clientHeight)
      .backgroundColor('rgba(0, 0, 0, 0)') // Transparent background
      .nodeLabel('label')
      .nodeAutoColorBy('type')
      .nodeColor(node => {
        switch(node.type) {
          case 'PERSON': return '#00f5ff'; // Cyan
          case 'ORG': return '#ffb300';    // Amber
          case 'GPE': return '#7cff7c';    // Green
          case 'EVENT': return '#ff2d2d';  // Red
          default: return '#ffffff';
        }
      })
      .nodeRelSize(4)
      .nodeVal('count') // Size nodes by mention count
      .linkColor(() => 'rgba(0, 245, 255, 0.2)')
      .linkWidth(link => Math.max(0.5, link.weight * 0.5))
      .linkDirectionalParticles(link => link.weight)
      .linkDirectionalParticleSpeed(d => d.weight * 0.005)
      .onNodeClick(node => {
        NemesisUI.log(`Graph Node selected: ${node.label} (${node.type})`);
        
        // If it's a location (GPE), we try to focus the globe on it
        if (node.type === 'GPE' && globeInstance) {
            if (node.lat !== undefined && node.lon !== undefined) {
                NemesisUI.log(`Targeting location: ${node.label} [${node.lat.toFixed(2)}°, ${node.lon.toFixed(2)}°]`, 'warn');
                globeInstance._globe.pointOfView({ lat: node.lat, lng: node.lon, altitude: 0.6 }, 2000);
                NemesisUI.triggerTargetLock();
                NemesisUI.triggerCCTV(`INTEL: ${node.label.toUpperCase()}`);
            } else {
                NemesisUI.log(`Targeting location: ${node.label}... (Geocoding data unavailable)`, 'warn');
            }
        }
      });

    // Make the camera look at the center
    this._graph.cameraPosition({ z: 150 });

    // Handle container resize
    new ResizeObserver(() => {
      this._graph.width(container.clientWidth);
      this._graph.height(container.clientHeight);
    }).observe(container);

    this._fetchInitialGraph();
    this._connectWebSocket();

    NemesisUI.log('NLP Knowledge Graph (3d-force-graph): ONLINE', 'ok');
  }

  async _fetchInitialGraph() {
    try {
      const response = await fetch('http://localhost:8000/api/knowledge-graph');
      if (response.ok) {
        const data = await response.json();
        const nodes = data.nodes || data.graph?.nodes || [];
        const links = data.links || data.graph?.links || [];
        this._updateGraph({ nodes, links });
        NemesisUI.log(`Knowledge Graph loaded: ${nodes.length} entities, ${links.length} relationships`, 'ok');
      }
    } catch (err) {
      NemesisUI.log('Waiting for OSINT Knowledge Graph data...', 'warn');
    }
  }

  _connectWebSocket() {
    try {
      this._ws = new WebSocket('ws://localhost:8000/ws/knowledge-graph');
      
      this._ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'GRAPH_UPDATE' || msg.type === 'GRAPH_SNAPSHOT') {
            const nodes = msg.nodes || msg.graph?.nodes || [];
            const links = msg.links || msg.graph?.links || [];
            this._updateGraph({ nodes, links });
            NemesisUI.log('Knowledge Graph updated from live OSINT feed.', 'ok');
          }
        } catch (e) {
          // Ignore parse errors
        }
      };

      this._ws.onclose = () => {
        this._reconnectTimer = setTimeout(() => this._connectWebSocket(), 10000);
      };
    } catch (e) {
      this._reconnectTimer = setTimeout(() => this._connectWebSocket(), 10000);
    }
  }

  _updateGraph(data) {
    const nodes = data.nodes || data.graph?.nodes || [];
    const links = data.links || data.graph?.links || [];
    if (this._graph && nodes && links) {
      this._data = { nodes, links };
      this._graph.graphData(this._data);
      
      // Extract article titles from graph nodes for news feed
      if (nodes.length > 0) {
        // Try to get real article titles from nodes
        const articleItems = [];
        
        nodes.forEach(node => {
          if (node.articles && node.articles.length > 0) {
            node.articles.forEach(art => {
              if (art.title && art.title.length > 10) {
                articleItems.push({
                  title:       art.title,
                  source:      art.source || node.label || 'OSINT',
                  url:         art.url || '#',
                  location:    node.type === 'GPE' ? node.label : null,
                  description: art.description || '',
                });
              }
            });
          }
        });

        // Deduplicate by title
        const seen = new Set();
        const unique = articleItems.filter(a => {
          if (seen.has(a.title)) return false;
          seen.add(a.title);
          return true;
        }).slice(0, 10);

        if (unique.length > 0) {
          NemesisUI.renderNewsCards(unique);
        } else {
          // Fallback — show entity counts more meaningfully
          const meaningful = nodes
            .filter(n => n.count >= 2 && n.label && n.label.length > 1)
            .sort((a,b) => (b.count||0) - (a.count||0))
            .slice(0, 8)
            .map(n => ({
              title:    `${n.label} — trending in ${n.count} articles`,
              source:   n.type || 'OSINT',
              url:      '#',
              location: n.type === 'GPE' ? n.label : null,
            }));
          NemesisUI.renderNewsCards(meaningful);
        }
      }
    }
  }
}
