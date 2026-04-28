#!/usr/bin/node

/**
 * Post-install script to patch @letta-ai packages
 * 
 * Applies the following patches:
 * 1. Context window values in @letta-ai/letta-code (zai/glm-5, zai/glm-4.7)
 * 2. Windows spawn options in @letta-ai/letta-code-sdk to prevent popup terminals
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveNodeModulePath(...segments) {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', ...segments),
    path.join(__dirname, '..', '..', '..', 'node_modules', ...segments),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

// Model handle -> correct context window limit
const CONTEXT_WINDOW_FIXES = {
  'zai/glm-5': 180000,
  'zai/glm-4.7': 180000,
};

function patchContextWindows() {
  const lettaCodePath = resolveNodeModulePath('@letta-ai', 'letta-code', 'letta.js');

  if (!fs.existsSync(lettaCodePath)) {
    console.warn('[letta-teams] Could not find @letta-ai/letta-code/letta.js - skipping patch');
    return;
  }

  let content = fs.readFileSync(lettaCodePath, 'utf-8');
  let patched = false;

  for (const [modelHandle, correctLimit] of Object.entries(CONTEXT_WINDOW_FIXES)) {
    // Pattern to match: handle: "zai/glm-5", ... context_window: 200000
    // We need to find the model config block and replace the context_window value
    const escapedHandle = modelHandle.replace('/', '\\/');
    
    // Find the position of this model's handle
    const handleRegex = new RegExp(`handle:\\s*"${escapedHandle}"`, 'g');
    const handleMatch = handleRegex.exec(content);
    
    if (handleMatch) {
      // Find the context_window in the same object (within next ~200 chars)
      const searchStart = handleMatch.index;
      const searchEnd = Math.min(searchStart + 500, content.length);
      const searchArea = content.slice(searchStart, searchEnd);
      
      // Match context_window: <number>
      const contextRegex = /context_window:\s*(\d+)/;
      const contextMatch = contextRegex.exec(searchArea);
      
      if (contextMatch) {
        const oldValue = parseInt(contextMatch[1]);
        if (oldValue !== correctLimit) {
          // Calculate absolute position
          const absPos = searchStart + contextMatch.index;
          
          // Replace the old value with the new one
          content = content.slice(0, absPos) + 
                    `context_window: ${correctLimit}` + 
                    content.slice(absPos + contextMatch[0].length);
          
          console.log(`[letta-teams] Patched ${modelHandle}: context_window ${oldValue} -> ${correctLimit}`);
          patched = true;
        }
      }
    }
  }

  if (patched) {
    fs.writeFileSync(lettaCodePath, content, 'utf-8');
    console.log('[letta-teams] Context window patches applied successfully!');
  } else {
    console.log('[letta-teams] No context window patches needed (already patched or models not found)');
  }
}

/**
 * Patch SDK spawn calls to hide console windows on Windows
 */
function patchSdkSpawn() {
  const sdkPath = resolveNodeModulePath('@letta-ai', 'letta-code-sdk', 'dist', 'index.js');

  if (!fs.existsSync(sdkPath)) {
    console.warn('[letta-teams] Could not find @letta-ai/letta-code-sdk/dist/index.js - skipping patch');
    return;
  }

  let content = fs.readFileSync(sdkPath, 'utf-8');
  
  // Pattern: spawn("node", [cliPath, ...args], {
  //            cwd: ...,
  //            stdio: [...],
  //            env: {...}
  //          })
  // We want to add: windowsHide: true
  
  const spawnPattern = /(spawn\("node",\s*\[cliPath,\s*\.\.\.args\],\s*\{[^}]*stdio:\s*\[[^\]]+\],[^}]*env:\s*\{[^}]+\})/;
  const match = spawnPattern.exec(content);
  
  if (match) {
    // Check if windowsHide is already present
    if (content.includes('windowsHide')) {
      console.log('[letta-teams] SDK spawn already patched (windowsHide found)');
      return;
    }
    
    // Add windowsHide: true after env
    const replacement = match[1] + ',\n      windowsHide: true';
    content = content.replace(match[1], replacement);
    
    fs.writeFileSync(sdkPath, content, 'utf-8');
    console.log('[letta-teams] Patched SDK spawn to hide console windows on Windows');
  } else {
    console.warn('[letta-teams] Could not find spawn pattern in SDK - skipping patch');
  }
}

/**
 * Patch Letta Code CLI spawn calls to hide console windows on Windows
 */
function patchLettaCodeSpawn() {
  const lettaCodePath = resolveNodeModulePath('@letta-ai', 'letta-code', 'letta.js');

  if (!fs.existsSync(lettaCodePath)) {
    console.warn('[letta-teams] Could not find @letta-ai/letta-code/letta.js - skipping patch');
    return;
  }

  let content = fs.readFileSync(lettaCodePath, 'utf-8');
  let patched = false;

  // Patch 1: Line ~36215 - childProcessOptions initialization
  // Replace: const childProcessOptions = {};
  // With: const childProcessOptions = { windowsHide: true };
  const initPattern = /const childProcessOptions = \{\};/;
  if (initPattern.test(content)) {
    content = content.replace(initPattern, 'const childProcessOptions = { windowsHide: true };');
    patched = true;
    console.log('[letta-teams] Patched Letta Code spawn childProcessOptions initialization');
  }

  // Patch 2: Line ~38707 - hook spawn call
  // Find: stdio: ["pipe", "pipe", "pipe"]
  // Replace with: stdio: ["pipe", "pipe", "pipe"],
  //                windowsHide: true
  const hookSpawnPattern = /stdio:\s*\["pipe",\s*"pipe",\s*"pipe"\](\s*\})/;
  const hookMatch = hookSpawnPattern.exec(content);
  
  if (hookMatch) {
    // Check if windowsHide already exists nearby
    const checkStart = Math.max(0, hookMatch.index - 300);
    const checkEnd = Math.min(content.length, hookMatch.index + 100);
    const checkBlock = content.slice(checkStart, checkEnd);
    
    if (!checkBlock.includes('windowsHide')) {
      const replacement = 'stdio: ["pipe", "pipe", "pipe"],\n    windowsHide: true' + hookMatch[1];
      content = content.replace(hookMatch[0], replacement);
      patched = true;
      console.log('[letta-teams] Patched Letta Code hook spawn call');
    }
  }

  if (patched) {
    fs.writeFileSync(lettaCodePath, content, 'utf-8');
  } else {
    console.log('[letta-teams] Letta Code spawn calls already patched or not found');
  }
}

// Run the patches
patchContextWindows();
patchSdkSpawn();
patchLettaCodeSpawn();
