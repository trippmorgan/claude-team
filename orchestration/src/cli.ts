/**
 * Claude Team Orchestration CLI
 *
 * Command-line tool for managing multi-agent workflows.
 */

import { Command } from 'commander';
import http from 'http';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8888';
const CLAUDE_HUB_URL = process.env.CLAUDE_HUB_URL || 'http://localhost:4847';

async function request(url: string, method = 'GET', body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {}
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

const program = new Command();

program
  .name('orchestrate')
  .description('Claude Team Orchestration CLI')
  .version('1.0.0');

// Status command
program
  .command('status')
  .description('Get orchestrator status')
  .action(async () => {
    try {
      const [orchestrator, hub] = await Promise.all([
        request(`${ORCHESTRATOR_URL}/health`).catch(() => ({ status: 'offline' })),
        request(`${CLAUDE_HUB_URL}/health`).catch(() => ({ status: 'offline' }))
      ]);

      console.log('\n=== Claude Team Status ===\n');
      console.log('Orchestrator:', orchestrator.status === 'ok' ? '✅ Online' : '❌ Offline');
      if (orchestrator.status === 'ok') {
        console.log(`  Agents: ${orchestrator.agents}`);
        console.log(`  Tasks: ${orchestrator.tasks}`);
        console.log(`  Workflows: ${orchestrator.workflows}`);
      }

      console.log('\nClaude Hub:', hub.status === 'ok' ? '✅ Online' : '❌ Offline');
      if (hub.status === 'ok') {
        console.log(`  Windows: ${hub.windows}`);
        if (hub.windowList) {
          hub.windowList.forEach((w: string) => console.log(`    - ${w}`));
        }
      }
      console.log('');
    } catch (err: any) {
      console.error('Error:', err.message);
    }
  });

// Agents command
program
  .command('agents')
  .description('List connected agents')
  .action(async () => {
    try {
      const result = await request(`${ORCHESTRATOR_URL}/agents`);
      console.log('\n=== Connected Agents ===\n');

      if (result.agents?.length === 0) {
        console.log('No agents connected');
      } else {
        result.agents?.forEach((agent: any) => {
          const statusIcon = agent.status === 'idle' ? '🟢' :
                            agent.status === 'busy' ? '🟡' : '🔴';
          console.log(`${statusIcon} ${agent.name} (${agent.type})`);
          console.log(`   ID: ${agent.id}`);
          console.log(`   Capabilities: ${agent.capabilities.join(', ')}`);
          if (agent.projectPath) {
            console.log(`   Project: ${agent.projectPath}`);
          }
          console.log('');
        });
      }
    } catch (err: any) {
      console.error('Error:', err.message);
    }
  });

// Tasks command
program
  .command('tasks')
  .description('List tasks')
  .option('-s, --status <status>', 'Filter by status')
  .action(async (options) => {
    try {
      const result = await request(`${ORCHESTRATOR_URL}/tasks`);
      console.log('\n=== Tasks ===\n');

      let tasks = result.tasks || [];
      if (options.status) {
        tasks = tasks.filter((t: any) => t.status === options.status);
      }

      if (tasks.length === 0) {
        console.log('No tasks found');
      } else {
        tasks.forEach((task: any) => {
          const statusIcon = task.status === 'completed' ? '✅' :
                            task.status === 'in_progress' ? '⏳' :
                            task.status === 'failed' ? '❌' : '⏸️';
          console.log(`${statusIcon} ${task.name} [${task.priority}]`);
          console.log(`   ID: ${task.id}`);
          console.log(`   Status: ${task.status}`);
          if (task.assignedTo) {
            console.log(`   Assigned to: ${task.assignedTo}`);
          }
          if (task.result) {
            console.log(`   Result: ${JSON.stringify(task.result).substring(0, 100)}`);
          }
          if (task.error) {
            console.log(`   Error: ${task.error}`);
          }
          console.log('');
        });
      }
    } catch (err: any) {
      console.error('Error:', err.message);
    }
  });

// Create task command
program
  .command('create-task <name>')
  .description('Create a new task')
  .option('-d, --description <desc>', 'Task description')
  .option('-p, --priority <priority>', 'Priority: low, normal, high, critical', 'normal')
  .option('-a, --assign <agentId>', 'Assign to agent')
  .action(async (name, options) => {
    try {
      const result = await request(`${ORCHESTRATOR_URL}/tasks`, 'POST', {
        name,
        description: options.description || '',
        priority: options.priority,
        assignedTo: options.assign
      });

      console.log('\n✅ Task created:', result.task?.id);
      console.log(`   Name: ${result.task?.name}`);
      console.log(`   Status: ${result.task?.status}`);
      console.log('');
    } catch (err: any) {
      console.error('Error:', err.message);
    }
  });

// Create workflow command
program
  .command('create-workflow <name>')
  .description('Create a workflow from JSON file or inline')
  .option('-f, --file <file>', 'JSON file with workflow definition')
  .option('-t, --tasks <tasks>', 'Comma-separated task names')
  .action(async (name, options) => {
    try {
      let tasks: any[] = [];

      if (options.file) {
        const fs = await import('fs');
        const data = JSON.parse(fs.readFileSync(options.file, 'utf-8'));
        tasks = data.tasks;
      } else if (options.tasks) {
        tasks = options.tasks.split(',').map((t: string) => ({ name: t.trim() }));
      }

      const result = await request(`${ORCHESTRATOR_URL}/workflows`, 'POST', {
        name,
        tasks
      });

      console.log('\n✅ Workflow created:', result.workflow?.id);
      console.log(`   Name: ${result.workflow?.name}`);
      console.log(`   Tasks: ${result.workflow?.tasks?.length}`);
      console.log('');
    } catch (err: any) {
      console.error('Error:', err.message);
    }
  });

// Run workflow command
program
  .command('run-workflow <workflowId>')
  .description('Run a workflow')
  .action(async (workflowId) => {
    try {
      const result = await request(`${ORCHESTRATOR_URL}/workflows/${workflowId}/run`, 'POST');

      console.log('\n🚀 Workflow started:', result.result?.id);
      console.log(`   Status: ${result.result?.status}`);
      console.log('');
    } catch (err: any) {
      console.error('Error:', err.message);
    }
  });

// Query command
program
  .command('query <target> <question>')
  .description('Send query to an agent')
  .action(async (target, question) => {
    try {
      // Send via hub webhook
      const result = await request(`${CLAUDE_HUB_URL}/webhook`, 'POST', {
        source: 'cli',
        event: {
          type: 'query',
          target,
          question
        }
      });

      console.log('\n📤 Query sent');
      console.log(`   Target: ${target}`);
      console.log(`   ID: ${result.id}`);
      console.log('');
    } catch (err: any) {
      console.error('Error:', err.message);
    }
  });

// Broadcast command
program
  .command('broadcast <message>')
  .description('Broadcast message to all agents')
  .option('-c, --category <category>', 'Category: update, decision, blocker, heads_up', 'update')
  .action(async (message, options) => {
    try {
      const result = await request(`${CLAUDE_HUB_URL}/webhook`, 'POST', {
        source: 'cli',
        event: {
          type: 'broadcast',
          message,
          category: options.category
        }
      });

      console.log('\n📢 Broadcast sent');
      console.log(`   Message: ${message}`);
      console.log(`   Category: ${options.category}`);
      console.log('');
    } catch (err: any) {
      console.error('Error:', err.message);
    }
  });

program.parse();
