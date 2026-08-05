(function () {
  "use strict";

  var canvas = document.getElementById("previewCanvas");
  var gl = canvas.getContext("webgl2", { antialias: true, alpha: false, preserveDrawingBuffer: false });
  var blackTexture = null;
  var state = {
    vertex: null,
    postVertex: null,
    fragments: [],
    connections: [],
    pingPongs: [],
    blackInputs: {},
    activeConnections: [],
    activePingPongs: [],
    nextPingPongId: 1,
    textures: [],
    retiredTextures: [],
    textureImportRevisions: {},
    textureNodes: [],
    nextTextureNodeId: 1,
    outputPass: -1,
    activeOutputPass: -1,
    modelPass: -1,
    graphs: createGraphStates(),
    activeGraph: "model",
    obj: null,
    geometry: "sphere",
    selectedShader: { stage: "vertex", index: 0 },
    uniforms: {},
    uniformTypes: {},
    matrixInputs: {},
    attributeInputs: {},
    uniformValueCache: new WeakMap(),
    builtinAliases: defaultBuiltinAliases(),
    interfaceWarningSignature: null,
    scannedUniforms: [],
    passes: [],
    compileRevision: 0,
    readingRevision: null,
    previewRevision: 0,
    autoCompileTimer: null,
    autoCompileBlocked: false,
    startedAt: performance.now(),
    tick: 0,
    graphInteractionActive: false,
    paused: false,
    pausedAt: null,
    runtimeErrorLogged: false,
    yaw: 0.55,
    pitch: 0.28,
    dragging: false,
    pointerX: 0,
    pointerY: 0
  };

  function createGraphState() {
    return {
      positions: {},
      viewport: { x: 0, y: 0, zoom: 1 },
      needsFit: true
    };
  }

  function createGraphStates() {
    return { model: createGraphState(), post: createGraphState() };
  }

  function graphState(chain) {
    return state.graphs[chain === "post" ? "post" : "model"];
  }

  function chainForPass(passIndex) {
    return passIndex === state.modelPass ? "model" : "post";
  }

  var defaultVertex = [
    "#version 300 es",
    "precision highp float;",
    "layout(location=0) in vec3 position;",
    "layout(location=1) in vec3 normal;",
    "layout(location=2) in vec2 uv;",
    "uniform mat4 model;",
    "uniform mat4 view;",
    "uniform mat4 projection;",
    "out vec3 vNormal;",
    "out vec2 vUv;",
    "void main(){ vNormal=mat3(model)*normal; vUv=uv; gl_Position=projection*view*model*vec4(position,1.0); }"
  ].join("\n");

  var sceneEye = new THREE.Vector3();
  var sceneCamera = new THREE.PerspectiveCamera(45, 1, .05, 100);
  var sceneMatrixValues = {
    model: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    view: new Float32Array(16),
    projection: new Float32Array(16),
    eye: new Float32Array(3)
  };

  function ide(action, stage, extra) {
    var request = extra || {};
    request.action = action;
    request.stage = stage || null;
    return ideQuery(JSON.stringify(request)).then(function (text) {
      return JSON.parse(text || "{}");
    });
  }

  function log(message, kind) {
    var output = document.getElementById("console");
    var line = document.createElement("span");
    line.className = kind || "info";
    line.textContent = "[" + new Date().toLocaleTimeString() + "] " + message + "\n";
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  }

  function setStatus(text, kind) {
    var status = document.getElementById("status");
    status.textContent = text;
    status.className = "status " + (kind || "idle");
  }

  function markModified() {
    setStatus(state.passes.length ? "待重新编译" : "待编译", "idle");
  }

  function clearCompiledPreview() {
    if (state.autoCompileTimer !== null) clearTimeout(state.autoCompileTimer);
    state.autoCompileTimer = null;
    if (gl) {
      gl.useProgram(null);
      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    state.passes.forEach(disposePass);
    state.activePingPongs.forEach(disposePingPongRuntime);
    state.passes = [];
    state.activeConnections = [];
    state.activePingPongs = [];
    state.activeOutputPass = -1;
    state.tick = 0;
    state.paused = false;
    state.pausedAt = null;
    state.runtimeErrorLogged = false;
    disposeRetiredTextures();
    if (gl) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.055, 0.064, 0.075, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
    document.getElementById("pause").textContent = "II";
    document.getElementById("pause").classList.remove("resume");
    document.getElementById("canvasMessage").classList.remove("hidden");
  }

  function graphModified() {
    if (!state.fragments.length) {
      clearCompiledPreview();
      markModified();
      return;
    }
    if (state.autoCompileBlocked) {
      setStatus("需手动编译", "error");
      return;
    }
    markModified();
    if (!gl || !state.fragments.length || state.fragments.some(function (file) { return !file; })) return;
    if (state.autoCompileTimer !== null) clearTimeout(state.autoCompileTimer);
    state.autoCompileTimer = setTimeout(function () {
      state.autoCompileTimer = null;
      compileAll(true);
    }, 180);
  }

  function blockAutoCompile(automatic) {
    if (state.autoCompileTimer !== null) clearTimeout(state.autoCompileTimer);
    state.autoCompileTimer = null;
    state.autoCompileBlocked = true;
    if (automatic) log("自动编译已暂停；修正 Graph 后请手动编译。", "warning");
  }

  function addShaderNode(kind, nodePosition) {
    if (kind === "model" && state.modelPass >= 0) {
      log("模型渲染链中只能有一个模型渲染节点。", "warning");
      return;
    }
    state.compileRevision++;
    var index = kind === "model" ? 0 : state.fragments.length;
    if (kind === "model") {
      state.fragments.unshift(null);
      state.connections = state.connections.map(function (connection) {
        return {
          from: Number.isInteger(connection.from) ? connection.from + 1 : connection.from,
          textureNode: connection.textureNode,
          pingPong: connection.pingPong,
          to: connection.to + 1,
          input: connection.input
        };
      });
      state.uniforms = shiftShaderUniformPassesForInsertion(state.uniforms, 0);
      state.uniformTypes = shiftShaderUniformPassesForInsertion(state.uniformTypes, 0);
      state.matrixInputs = shiftShaderUniformPassesForInsertion(state.matrixInputs, 0);
      state.blackInputs = shiftUniformPassesForInsertion(state.blackInputs, 0);
      ["model", "post"].forEach(function (chain) {
        var graph = graphState(chain);
        graph.positions = shiftGraphPassPositionsForInsertion(graph.positions, 0);
      });
      state.pingPongs.forEach(function (pingPong) {
        if (Number.isInteger(pingPong.from)) pingPong.from++;
      });
      if (state.outputPass >= 0) state.outputPass++;
      state.modelPass = 0;
    } else {
      state.fragments.push(null);
    }
    state.selectedShader = { stage: "fragment", index: index };
    if (kind !== "model" || state.outputPass < 0) state.outputPass = index;
    var chain = kind === "model" ? "model" : "post";
    if (nodePosition) graphState(chain).positions["pass:" + index] = availableGraphPosition(chain, nodePosition);
    else graphState(chain).needsFit = true;
    connectDefaultPasses();
    renderPassSlots();
    mergeScannedUniforms();
    renderGraph();
    graphModified();
  }

  function addFragmentPass() {
    addShaderNode("post");
  }

  function connectDefaultPasses() {
    reconcileConnections();
    for (var pass = 1; pass < state.fragments.length; pass++) {
      var inputs = samplerInputs(pass).filter(function (input) { return input.supported; });
      if (!inputs.length) continue;
      var input = inputs[0];
      if (!connectionSetting(pass, input.name) && !usesDefaultBlack(pass, input.name) && passOutput(pass - 1).supported) {
        state.connections.push({ from: pass - 1, to: pass, input: input.name });
      }
    }
  }

  function samplerInputs(passIndex) {
    var file = state.fragments[passIndex];
    var compiled = state.passes[passIndex];
    if (compiled && file && compiled.file.path === file.path && compiled.source === file.source) {
      return compiled.samplers;
    }
    return declaredSamplerInputs(file);
  }

  function declaredSamplerInputs(file) {
    if (!file || !file.interfaces) return [];
    return file.interfaces.filter(function (item) {
      return item.storage === "uniform" && /^(?:[iu]?sampler)/.test(item.type);
    }).map(function (item) {
      return {
        name: item.name,
        type: item.type + (item.array || ""),
        supported: item.type === "sampler2D" && !item.array
      };
    });
  }

  function mergeSamplerInputs(file, reflected) {
    var merged = declaredSamplerInputs(file);
    (reflected || []).forEach(function (input) {
      var index = merged.findIndex(function (candidate) { return candidate.name === input.name; });
      var copy = { name: input.name, type: input.type, supported: input.supported };
      if (index >= 0) merged[index] = copy;
      else merged.push(copy);
    });
    return merged;
  }

  function passOutput(passIndex) {
    var file = state.fragments[passIndex];
    if (!file) return { name: "颜色 0", type: "vec4", location: 0, supported: false, reason: "未绑定" };
    var compiled = state.passes[passIndex];
    if (compiled && file && compiled.file.path === file.path && compiled.source === file.source) {
      return compiled.output;
    }
    return describePassOutput(file);
  }

  function connectionSetting(to, input) {
    return findConnection(state.connections, to, input);
  }

  function findConnection(connections, to, input) {
    return connections.filter(function (connection) {
      return connection.to === to && connection.input === input;
    })[0] || null;
  }

  function setConnection(to, input, source) {
    var targetChain = chainForPass(to);
    if (source && source.textureNode) {
      var textureNode = textureNodeById(source.textureNode);
      if (!textureNode || textureNode.chain !== targetChain) {
        log("纹理节点只能连接同一节点图中的着色器。", "error");
        return;
      }
    }
    if (source && source.pingPong) {
      var pingPong = pingPongById(source.pingPong);
      if (!pingPong || pingPong.chain !== targetChain) {
        log("Ping-Pong 只能连接同一节点图中的着色器。", "error");
        return;
      }
    }
    if (source && Number.isInteger(source.from)) {
      var sourceChain = chainForPass(source.from);
      if (sourceChain !== targetChain && !(sourceChain === "model" && targetChain === "post")) {
        log("通道输出不能跨节点图反向连接。", "error");
        return;
      }
    }
    state.connections = state.connections.filter(function (connection) {
      return connection.to !== to || connection.input !== input;
    });
    if (source) {
      delete state.blackInputs[uniformKey(to, input)];
      state.connections.push({
        from: source.from,
        textureNode: source.textureNode,
        pingPong: source.pingPong,
        to: to,
        input: input
      });
    } else {
      state.blackInputs[uniformKey(to, input)] = true;
    }
    renderGraph();
    graphModified();
  }

  function warnShaderInterfaces() {
    var issues = [];
    state.fragments.forEach(function (_, index) {
      interfaceIssuesForPass(index).forEach(function (issue) {
        var postIndex = state.fragments.slice(0, index + 1).filter(function (_, passIndex) {
          return passIndex !== state.modelPass;
        }).length;
        var label = index === state.modelPass ? "模型渲染" : "后处理 " + postIndex;
        issues.push(label + "：" + issue);
      });
    });
    issues = issues.filter(function (issue, index) { return issues.indexOf(issue) === index; });
    var signature = issues.join("\n");
    if (!signature) {
      state.interfaceWarningSignature = null;
      return;
    }
    if (signature === state.interfaceWarningSignature) return;
    state.interfaceWarningSignature = signature;
    showInterfaceWarning(issues);
  }

  function interfaceIssuesForPass(passIndex) {
    var fragment = state.fragments[passIndex];
    if (!fragment || !fragment.interfaces) return [];
    var usesModel = passIndex === state.modelPass;
    var vertex = usesModel ? state.vertex : state.postVertex;
    var outputs = vertex && vertex.interfaces ? vertex.interfaces.filter(isVertexOutput) :
      usesModel ? [
        { name: "vNormal", type: "vec3", array: null, layout: {} },
        { name: "vUv", type: "vec2", array: null, layout: {} }
      ] : [{ name: "vUv", type: "vec2", array: null, layout: {} }];
    var inputs = fragment.interfaces.filter(function (item) {
      return !item.builtin && (item.storage === "in" || item.storage === "varying");
    });
    var issues = [];
    if (!usesModel && state.postVertex) {
      var hasUv = state.postVertex.interfaces.filter(isVertexInput).some(function (input) {
        var setting = state.attributeInputs[attributeInputKey("postVertex", input.name)];
        return setting && setting.semantic === "uv";
      });
      if (!hasUv) issues.push("自定义后处理 VSH 没有映射为 UV 的输入");
    }
    inputs.forEach(function (input) {
      var location = interfaceLocation(input);
      var output = matchingVertexOutput(outputs, input);
      var inputType = interfaceType(input);
      if (!output) {
        var namedOutput = outputs.filter(function (candidate) { return candidate.name === input.name; })[0];
        var outputLocation = interfaceLocation(namedOutput);
        if (location !== null && outputLocation !== null) {
          issues.push("接口 '" + input.name + "' 的 location 不一致，VSH 为 " + outputLocation + "，FSH 为 " + location);
        } else {
          issues.push("FSH 输入 '" + input.name + "' (" + inputType + ") 没有对应的 VSH 输出");
        }
        return;
      }
      var outputType = interfaceType(output);
      if (outputType !== inputType) {
        var interfaceLabel = output.name === input.name ? "接口 '" + input.name + "'" :
          "location " + location + "（VSH '" + output.name + "' / FSH '" + input.name + "'）";
        issues.push(interfaceLabel + " 类型或数组长度不一致，VSH 为 " + outputType + "，FSH 为 " + inputType);
      }
    });
    return issues;
  }

  function matchingVertexOutput(outputs, input) {
    var inputLocation = interfaceLocation(input);
    if (inputLocation !== null) {
      var located = outputs.filter(function (candidate) {
        return interfaceLocation(candidate) === inputLocation;
      })[0];
      if (located) return located;
    }
    return outputs.filter(function (candidate) {
      var outputLocation = interfaceLocation(candidate);
      return candidate.name === input.name && (inputLocation === null || outputLocation === null);
    })[0] || null;
  }

  function interfaceType(item) {
    return (String(item.type || "") + String(item.array || "")).replace(/\s+/g, "");
  }

  function isVertexOutput(item) {
    return !item.builtin && (item.storage === "out" || item.storage === "varying");
  }

  function interfaceLocation(item) {
    var value = item && item.layout ? item.layout.location : undefined;
    if (value === undefined || value === null || value === "") return null;
    return String(value).replace(/\s+/g, "");
  }

  function showInterfaceWarning(issues) {
    var dialog = document.getElementById("interfaceWarning");
    var body = document.getElementById("interfaceWarningBody");
    body.textContent = "";
    var summary = document.createElement("p");
    summary.textContent = "顶点输出与片元输入无法完整匹配。编译链接可能失败；即使能够链接，也可能出现黑屏、插值错误或未定义数据。";
    body.appendChild(summary);
    var list = document.createElement("ul");
    issues.forEach(function (issue) {
      var item = document.createElement("li");
      item.textContent = issue;
      list.appendChild(item);
    });
    body.appendChild(list);
    if (dialog.open) dialog.close();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else log("着色器接口不匹配：" + issues.join("；"), "warning");
  }

  function usesDefaultBlack(pass, input) {
    return state.blackInputs[uniformKey(pass, input)] === true;
  }

  function clearBlackInputs(pass) {
    Object.keys(state.blackInputs).forEach(function (key) {
      if (key.indexOf(pass + ":") === 0) delete state.blackInputs[key];
    });
  }

  function reconcileConnections() {
    var seen = {};
    state.connections = state.connections.filter(function (connection) {
      var key = connection.to + ":" + connection.input;
      var input = samplerInputs(connection.to).filter(function (candidate) {
        return candidate.name === connection.input && candidate.supported;
      })[0];
      var targetChain = chainForPass(connection.to);
      var textureNode = connection.textureNode && textureNodeById(connection.textureNode);
      var validTexture = textureNode && textureNode.chain === targetChain && textureById(textureNode.texture);
      var validPingPong = connection.pingPong && pingPongById(connection.pingPong);
      if (validPingPong && validPingPong.chain !== targetChain) validPingPong = null;
      var sourceChain = Number.isInteger(connection.from) ? chainForPass(connection.from) : null;
      var validPass = Number.isInteger(connection.from) &&
        connection.from >= 0 && connection.from < connection.to && passOutput(connection.from).supported &&
        (sourceChain === targetChain || sourceChain === "model" && targetChain === "post");
      var validSource = validTexture || validPingPong || validPass;
      if (!input || !validSource || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function renderPassSlots() {
    var host = document.getElementById("fragmentPasses");
    if (!host) return;
    host.textContent = "";
    state.fragments.forEach(function (file, index) {
      var slot = document.createElement("div");
      slot.className = "file-slot fragment-slot";
      slot.dataset.shaderStage = "fragment";
      slot.dataset.shaderIndex = String(index);
      slot.dataset.dropStage = "fragment";
      slot.dataset.dropIndex = String(index);
      var select = document.createElement("button");
      select.className = "slot-select";
      select.type = "button";
      select.title = "选择片元通道 " + (index + 1);
      select.innerHTML = '<span class="stage-badge fragment">F</span>' +
        '<span class="file-copy"><strong>片元通道 ' + (index + 1) + '</strong><small>' + escapeHtml(file ? file.name : "选择 .fragment、.frag、.fsh 或 .glsl") + '</small></span>';
      select.addEventListener("click", function () { selectShaderCard("fragment", index); });
      var browse = document.createElement("button");
      browse.className = "slot-browse";
      browse.type = "button";
      browse.title = "选择片元着色器文件";
      browse.setAttribute("aria-label", browse.title);
      browse.textContent = "...";
      browse.addEventListener("click", function () { chooseShader("fragment", index); });
      var remove = document.createElement("button");
      remove.className = "remove-slot";
      remove.type = "button";
      remove.title = file || state.fragments.length > 1 ? "删除片元通道" : "清空片元通道";
      remove.setAttribute("aria-label", remove.title);
      remove.textContent = "×";
      remove.addEventListener("click", function () { removeFragmentPass(index); });
      slot.appendChild(select);
      slot.appendChild(browse);
      slot.appendChild(remove);
      host.appendChild(slot);
    });
    refreshShaderSelection();
  }

  function selectShaderCard(stage, index) {
    state.selectedShader = { stage: stage, index: index || 0 };
    refreshShaderSelection();
    mergeScannedUniforms();
  }

  function refreshShaderSelection() {
    document.querySelectorAll("[data-shader-stage]").forEach(function (slot) {
      slot.classList.toggle("selected", slot.dataset.shaderStage === state.selectedShader.stage &&
        Number(slot.dataset.shaderIndex || 0) === state.selectedShader.index);
    });
  }

  function removeFragmentPass(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.fragments.length) return;
    state.compileRevision++;
    var removedModel = state.modelPass === index;
    state.fragments.splice(index, 1);
    if (state.outputPass === index) state.outputPass = state.fragments.length ? Math.min(index, state.fragments.length - 1) : -1;
    else if (state.outputPass > index) state.outputPass--;
    if (removedModel) {
      state.modelPass = -1;
    } else if (state.modelPass > index) {
      state.modelPass--;
    }
    state.connections = state.connections.filter(function (connection) {
      return connection.to !== index && connection.from !== index;
    }).map(function (connection) {
      return {
        from: Number.isInteger(connection.from) && connection.from > index ? connection.from - 1 : connection.from,
        textureNode: connection.textureNode,
        pingPong: connection.pingPong,
        to: connection.to > index ? connection.to - 1 : connection.to,
        input: connection.input
      };
    });
    state.uniforms = shiftShaderUniformPasses(state.uniforms, index);
    state.uniformTypes = shiftShaderUniformPasses(state.uniformTypes, index);
    state.matrixInputs = shiftShaderUniformPasses(state.matrixInputs, index);
    state.blackInputs = shiftUniformPasses(state.blackInputs, index);
    if (state.selectedShader.stage === "fragment") {
      if (state.selectedShader.index > index) state.selectedShader.index--;
      else if (state.selectedShader.index === index) state.selectedShader.index = Math.max(0, Math.min(index, state.fragments.length - 1));
    }
    if (state.selectedShader.stage === "fragment") {
      state.selectedShader.index = Math.max(0, state.selectedShader.index);
    }
    state.pingPongs.forEach(function (pingPong) {
      if (pingPong.from === index) pingPong.from = null;
      else if (Number.isInteger(pingPong.from) && pingPong.from > index) pingPong.from--;
    });
    ["model", "post"].forEach(function (chain) {
      var graph = graphState(chain);
      graph.positions = shiftGraphPassPositions(graph.positions, index);
      graph.needsFit = true;
    });
    connectDefaultPasses();
    renderPassSlots();
    mergeScannedUniforms();
    renderGraph();
    state.interfaceWarningSignature = null;
    warnShaderInterfaces();
    graphModified();
  }

  function shiftUniformPasses(values, removedPass) {
    var shifted = {};
    Object.keys(values).forEach(function (key) {
      var separator = key.indexOf(":");
      var pass = Number(key.slice(0, separator));
      if (!Number.isInteger(pass) || pass === removedPass) return;
      var nextPass = pass > removedPass ? pass - 1 : pass;
      shifted[nextPass + key.slice(separator)] = values[key];
    });
    return shifted;
  }

  function shiftShaderUniformPasses(values, removedPass) {
    return Object.keys(values).reduce(function (shifted, key) {
      var match = /^fragment:(\d+):(.*)$/.exec(key);
      if (!match) {
        shifted[key] = values[key];
        return shifted;
      }
      var pass = Number(match[1]);
      if (pass === removedPass) return shifted;
      shifted["fragment:" + (pass > removedPass ? pass - 1 : pass) + ":" + match[2]] = values[key];
      return shifted;
    }, {});
  }

  function shiftShaderUniformPassesForInsertion(values, insertedPass) {
    return Object.keys(values).reduce(function (shifted, key) {
      var match = /^fragment:(\d+):(.*)$/.exec(key);
      if (!match) {
        shifted[key] = values[key];
        return shifted;
      }
      var pass = Number(match[1]);
      shifted["fragment:" + (pass >= insertedPass ? pass + 1 : pass) + ":" + match[2]] = values[key];
      return shifted;
    }, {});
  }

  function shiftUniformPassesForInsertion(values, insertedPass) {
    var shifted = {};
    Object.keys(values).forEach(function (key) {
      var separator = key.indexOf(":");
      var pass = Number(key.slice(0, separator));
      if (!Number.isInteger(pass)) return;
      var nextPass = pass >= insertedPass ? pass + 1 : pass;
      shifted[nextPass + key.slice(separator)] = values[key];
    });
    return shifted;
  }

  function clearShaderUniformState(stage, index) {
    var prefix = stage === "fragment" ? "fragment:" + index + ":" : stage + ":";
    [state.uniforms, state.uniformTypes, state.matrixInputs].forEach(function (values) {
      Object.keys(values).forEach(function (key) {
        if (key.indexOf(prefix) === 0) delete values[key];
      });
    });
    Object.keys(state.attributeInputs).forEach(function (key) {
      if (key.indexOf(stage + ":") === 0) delete state.attributeInputs[key];
    });
  }

  function shiftGraphPassPositions(positions, removedPass) {
    return Object.keys(positions).reduce(function (shifted, key) {
      var match = /^pass:(\d+)$/.exec(key);
      if (!match) {
        shifted[key] = positions[key];
        return shifted;
      }
      var pass = Number(match[1]);
      if (pass === removedPass) return shifted;
      shifted["pass:" + (pass > removedPass ? pass - 1 : pass)] = positions[key];
      return shifted;
    }, {});
  }

  function shiftGraphPassPositionsForInsertion(positions, insertedPass) {
    return Object.keys(positions).reduce(function (shifted, key) {
      var match = /^pass:(\d+)$/.exec(key);
      if (!match) {
        shifted[key] = positions[key];
        return shifted;
      }
      var pass = Number(match[1]);
      shifted["pass:" + (pass >= insertedPass ? pass + 1 : pass)] = positions[key];
      return shifted;
    }, {});
  }

  function chooseShader(stage, index) {
    var previewRevision = state.previewRevision;
    var ideStage = stage === "postVertex" ? "vertex" : stage;
    ide("chooseShader", ideStage).then(function (response) {
      if (previewRevision !== state.previewRevision) return;
      if (response.cancelled) return;
      if (response.error) throw new Error(response.error);
      if (!response.file) return;
      applyShaderFile(stage, index, response.file);
    }).catch(function (error) { log(error.message, "error"); });
  }

  function applyShaderFile(stage, index, file) {
    state.compileRevision++;
    if (stage === "vertex") {
      state.vertex = file;
      state.selectedShader = { stage: "vertex", index: 0 };
      var vertexName = document.getElementById("vertexName");
      if (vertexName) vertexName.textContent = file.name;
    } else if (stage === "postVertex") {
      state.postVertex = file;
      state.selectedShader = { stage: "postVertex", index: 0 };
      document.getElementById("postVertexName").textContent = file.name;
    } else if (stage === "fragment") {
      var passIndex = index || 0;
      state.fragments[passIndex] = file;
      state.selectedShader = { stage: "fragment", index: passIndex };
      clearBlackInputs(passIndex);
      renderPassSlots();
    } else {
      throw new Error("不支持的着色器阶段：" + stage);
    }
    mergeScannedUniforms();
    connectDefaultPasses();
    renderGraph();
    graphModified();
    warnShaderInterfaces();
  }

  function clearVertexShader(stage) {
    if (stage === "postVertex") {
      if (!state.postVertex) return;
      state.postVertex = null;
      document.getElementById("postVertexName").textContent = "未绑定时使用内置全屏三角形";
    } else {
      if (!state.vertex) return;
      state.vertex = null;
      document.getElementById("vertexName").textContent = "选择 .vertex、.vert、.vsh 或 .glsl";
    }
    state.compileRevision++;
    clearShaderUniformState(stage, 0);
    mergeScannedUniforms();
    renderGraph();
    graphModified();
    warnShaderInterfaces();
  }

  function addTextureCard(nodePosition, chain) {
    chain = chain === "post" ? "post" : chain === "model" ? "model" : state.activeGraph;
    createTextureNode(null, nodePosition, chain);
    renderGraph(chain);
  }

  function chooseTexture(nodePosition, chain, textureNodeId) {
    chain = chain === "post" ? "post" : chain === "model" ? "model" : state.activeGraph;
    var previewRevision = state.previewRevision;
    ide("chooseTexture").then(function (response) {
      if (previewRevision !== state.previewRevision || response.cancelled) return;
      if (response.error) throw new Error(response.error);
      if (response.nativePicker) {
        return chooseBrowserTexture().then(function (texture) {
          if (texture) return installTexture(texture, previewRevision, nodePosition, chain, textureNodeId);
        });
      }
      if (response.texture) return installTexture(response.texture, previewRevision, nodePosition, chain, textureNodeId);
    }).catch(function (error) {
      if (previewRevision === state.previewRevision) log("无法导入纹理：" + error.message, "error");
    });
  }

  function chooseBrowserTexture() {
    return new Promise(function (resolve, reject) {
      var input = document.createElement("input");
      var settled = false;
      input.type = "file";
      input.accept = ".png,.jpg,.jpeg,.webp,.bmp,.gif,image/*";
      input.className = "hidden";
      document.body.appendChild(input);
      function finish(value, error) {
        if (settled) return;
        settled = true;
        input.remove();
        if (error) reject(error); else resolve(value);
      }
      input.addEventListener("change", function () {
        var file = input.files && input.files[0];
        if (!file) {
          finish(null);
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          finish({
            path: "browser://" + encodeURIComponent(file.name) + "?modified=" + file.lastModified,
            name: file.name,
            dataUrl: String(reader.result)
          });
        };
        reader.onerror = function () { finish(null, new Error("无法读取图片 " + file.name + "。")); };
        reader.readAsDataURL(file);
      });
      window.addEventListener("focus", function () {
        setTimeout(function () {
          if (!settled && (!input.files || !input.files.length)) finish(null);
        }, 0);
      }, { once: true });
      input.click();
    });
  }

  function installTexture(snapshot, previewRevision, nodePosition, chain, textureNodeId) {
    chain = chain === "post" ? "post" : chain === "model" ? "model" : state.activeGraph;
    var targetNode = textureNodeId ? textureNodeById(textureNodeId) : null;
    if (textureNodeId && !targetNode) return Promise.reject(new Error("纹理卡片已不存在。"));
    var targetRevision = targetNode ? (targetNode.importRevision || 0) + 1 : null;
    if (targetNode) targetNode.importRevision = targetRevision;
    var textureId = snapshot.path;
    var importRevision = targetNode ? null : (state.textureImportRevisions[textureId] || 0) + 1;
    if (!targetNode) state.textureImportRevisions[textureId] = importRevision;
    return createTextureResource(snapshot).then(function (texture) {
      var currentTarget = textureNodeId ? textureNodeById(textureNodeId) : null;
      var staleTarget = textureNodeId && (!currentTarget || currentTarget.importRevision !== targetRevision);
      var staleImport = !textureNodeId && state.textureImportRevisions[textureId] !== importRevision;
      if (previewRevision !== state.previewRevision || staleTarget || staleImport) {
        gl.deleteTexture(texture.glTexture);
        return;
      }
      var existingIndex = state.textures.findIndex(function (item) { return item.id === texture.id; });
      if (existingIndex >= 0) {
        state.retiredTextures.push(state.textures[existingIndex]);
        state.textures[existingIndex] = texture;
      } else {
        state.textures.push(texture);
      }
      if (currentTarget) currentTarget.texture = texture.id;
      else createTextureNode(texture.id, nodePosition, chain);
      retireUnusedTextures();
      state.compileRevision++;
      renderTextures();
      renderGraph();
      graphModified();
      log((currentTarget ? "已绑定纹理：" : "已导入纹理：") + texture.name + (texture.compatibilityUpload ? "（兼容上传）" : ""), "success");
    });
  }

  function createTextureResource(snapshot) {
    return new Promise(function (resolve, reject) {
      if (!gl) {
        reject(new Error("当前环境不支持 WebGL2。"));
        return;
      }
      var image = new Image();
      image.onload = function () {
        var width = image.naturalWidth;
        var height = image.naturalHeight;
        var maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        if (!width || !height) {
          reject(new Error("纹理图片尺寸无效：" + snapshot.name + "。"));
          return;
        }
        if (width > maxSize || height > maxSize) {
          reject(new Error("纹理 " + snapshot.name + " 的尺寸为 " + width + " x " + height + "，超过 WebGL2 上限 " + maxSize + " x " + maxSize + "。"));
          return;
        }
        var texture = gl.createTexture();
        if (!texture) {
          reject(new Error("无法创建 WebGL 纹理。"));
          return;
        }
        try {
          clearGlErrors();
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          var setupError = gl.getError();
          if (setupError !== gl.NO_ERROR) {
            throw new Error("配置纹理失败，WebGL 错误 0x" + setupError.toString(16) + "。");
          }
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
          var uploadError = gl.getError();
          var compatibilityUpload = false;
          if (uploadError !== gl.NO_ERROR) {
            compatibilityUpload = true;
            clearGlErrors();
            uploadTexturePixels(image, width, height);
            var fallbackError = gl.getError();
            if (fallbackError !== gl.NO_ERROR) {
              throw new Error("上传纹理 " + width + " x " + height + " 失败，图片上传错误 0x" + uploadError.toString(16) + "，像素上传错误 0x" + fallbackError.toString(16) + "。");
            }
          }
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.bindTexture(gl.TEXTURE_2D, null);
          var error = gl.getError();
          if (error !== gl.NO_ERROR) throw new Error("上传纹理失败，WebGL 错误 0x" + error.toString(16) + "。");
          resolve({
            id: snapshot.path,
            path: snapshot.path,
            name: snapshot.name,
            dataUrl: snapshot.dataUrl,
            width: width,
            height: height,
            compatibilityUpload: compatibilityUpload,
            glTexture: texture
          });
        } catch (error) {
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.bindTexture(gl.TEXTURE_2D, null);
          gl.deleteTexture(texture);
          reject(error);
        }
      };
      image.onerror = function () { reject(new Error("无法解码图片 " + snapshot.name + "。")); };
      image.src = snapshot.dataUrl;
    });
  }

  function uploadTexturePixels(image, width, height) {
    var source = document.createElement("canvas");
    source.width = width;
    source.height = height;
    var context = source.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法创建纹理转换画布。");
    context.setTransform(1, 0, 0, -1, 0, height);
    context.drawImage(image, 0, 0, width, height);
    var pixels = context.getImageData(0, 0, width, height).data;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    var bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  }

  function renderTextures() {
    var host = document.getElementById("textureInputs");
    if (!host) return;
    host.textContent = "";
    if (!state.textures.length) {
      host.innerHTML = '<p class="empty">暂无纹理。</p>';
      return;
    }
    state.textures.forEach(function (texture) {
      var item = document.createElement("div");
      item.className = "texture-slot";
      item.innerHTML = '<img alt="" src="' + escapeHtml(texture.dataUrl) + '">' +
        '<span><strong>' + escapeHtml(texture.name) + '</strong><small>' + texture.width + ' × ' + texture.height + '</small></span>';
      var remove = document.createElement("button");
      remove.className = "remove-slot";
      remove.type = "button";
      remove.title = "删除纹理";
      remove.setAttribute("aria-label", remove.title);
      remove.textContent = "×";
      remove.addEventListener("click", function () { removeTexture(texture.id); });
      item.appendChild(remove);
      host.appendChild(item);
    });
  }

  function removeTexture(id) {
    var texture = textureById(id);
    if (!texture) return;
    var nodeIds = state.textureNodes.filter(function (node) { return node.texture === id; }).map(function (node) { return node.id; });
    state.textureImportRevisions[id] = (state.textureImportRevisions[id] || 0) + 1;
    state.retiredTextures.push(texture);
    state.textures = state.textures.filter(function (item) { return item.id !== id; });
    state.connections.filter(function (connection) { return nodeIds.indexOf(connection.textureNode) >= 0; }).forEach(function (connection) {
      state.blackInputs[uniformKey(connection.to, connection.input)] = true;
    });
    state.connections = state.connections.filter(function (connection) { return nodeIds.indexOf(connection.textureNode) < 0; });
    state.textureNodes.filter(function (node) { return node.texture === id; }).forEach(function (node) {
      delete graphState(node.chain).positions[textureNodeId(node.id)];
    });
    state.textureNodes = state.textureNodes.filter(function (node) { return node.texture !== id; });
    disposeRetiredTextures();
    state.compileRevision++;
    renderTextures();
    renderGraph();
    graphModified();
  }

  function textureById(id) {
    return state.textures.filter(function (texture) { return texture.id === id; })[0] || null;
  }

  function disposeRetiredTextures() {
    var liveTextures = state.textures.map(function (texture) { return texture.glTexture; });
    state.activeConnections.forEach(function (connection) {
      if (connection.glTexture && liveTextures.indexOf(connection.glTexture) < 0) liveTextures.push(connection.glTexture);
    });
    state.retiredTextures = state.retiredTextures.filter(function (texture) {
      if (liveTextures.indexOf(texture.glTexture) >= 0) return true;
      gl.deleteTexture(texture.glTexture);
      return false;
    });
  }

  function retireUnusedTextures() {
    var referenced = {};
    state.textureNodes.forEach(function (node) {
      if (node.texture) referenced[node.texture] = true;
    });
    var unused = state.textures.filter(function (texture) { return !referenced[texture.id]; });
    state.textures = state.textures.filter(function (texture) { return referenced[texture.id]; });
    unused.forEach(function (texture) {
      if (!state.retiredTextures.some(function (retired) { return retired.glTexture === texture.glTexture; })) {
        state.retiredTextures.push(texture);
      }
    });
    disposeRetiredTextures();
  }

  function createTextureNode(textureId, nodePosition, chain) {
    chain = chain === "post" ? "post" : "model";
    var id = "texture-node-" + state.nextTextureNodeId++;
    state.textureNodes.push({ id: id, texture: textureId || null, chain: chain, importRevision: 0 });
    if (nodePosition) graphState(chain).positions[textureNodeId(id)] = availableGraphPosition(chain, nodePosition);
    return id;
  }

  function removeTextureNode(id) {
    if (!textureNodeById(id)) return;
    state.connections.filter(function (connection) { return connection.textureNode === id; }).forEach(function (connection) {
      state.blackInputs[uniformKey(connection.to, connection.input)] = true;
    });
    state.connections = state.connections.filter(function (connection) { return connection.textureNode !== id; });
    var textureNode = textureNodeById(id);
    state.textureNodes = state.textureNodes.filter(function (node) { return node.id !== id; });
    delete graphState(textureNode.chain).positions[textureNodeId(id)];
    retireUnusedTextures();
    state.compileRevision++;
    renderGraph();
    graphModified();
  }

  function textureNodeById(id) {
    return state.textureNodes.filter(function (node) { return node.id === id; })[0] || null;
  }

  function textureNodeId(id) {
    return "texture:" + id;
  }

  function availableGraphPosition(chain, position) {
    var nodeWidth = 310;
    var nodeHeight = 320;
    var gap = 16;
    var occupied = [];
    var rendered = {};
    var graph = graphState(chain);
    graphCanvasFor(chain).querySelectorAll(".graph-node").forEach(function (node) {
      if (node.dataset.nodeId) rendered[node.dataset.nodeId] = true;
      occupied.push({
        left: node.offsetLeft,
        top: node.offsetTop,
        width: node.offsetWidth || nodeWidth,
        height: node.offsetHeight || nodeHeight
      });
    });
    Object.keys(graph.positions).forEach(function (key) {
      if (rendered[key]) return;
      occupied.push({
        left: graph.positions[key].left,
        top: graph.positions[key].top,
        width: nodeWidth,
        height: nodeHeight
      });
    });
    for (var attempt = 0; attempt < 64; attempt++) {
      var column = attempt % 4;
      var row = Math.floor(attempt / 4);
      var candidate = {
        left: position.left + column * (nodeWidth + gap),
        top: position.top + row * (nodeHeight + gap)
      };
      var overlaps = occupied.some(function (other) {
        return candidate.left < other.left + other.width + gap &&
          candidate.left + nodeWidth + gap > other.left &&
          candidate.top < other.top + other.height + gap &&
          candidate.top + nodeHeight + gap > other.top;
      });
      if (!overlaps) return candidate;
    }
    return { left: position.left + nodeWidth + gap, top: position.top + nodeHeight + gap };
  }

  function addPingPongCard(nodePosition, chain) {
    chain = chain === "post" ? "post" : chain === "model" ? "model" : state.activeGraph;
    var sequence = state.nextPingPongId++;
    var id = "pingpong-" + sequence;
    var suffix = sequence === 1 ? "" : String(sequence);
    state.pingPongs.push({
      id: id,
      from: null,
      chain: chain,
      iterations: 1,
      iterationAlias: "iteration" + suffix + ", iIteration" + suffix,
      phaseAlias: "phase" + suffix + ", iPhase" + suffix
    });
    if (nodePosition) graphState(chain).positions[pingPongNodeId(id)] = availableGraphPosition(chain, nodePosition);
    state.compileRevision++;
    renderGraph();
    graphModified();
  }

  function removePingPong(id) {
    if (!pingPongById(id)) return;
    state.connections.filter(function (connection) { return connection.pingPong === id; }).forEach(function (connection) {
      state.blackInputs[uniformKey(connection.to, connection.input)] = true;
    });
    state.connections = state.connections.filter(function (connection) { return connection.pingPong !== id; });
    var pingPong = pingPongById(id);
    state.pingPongs = state.pingPongs.filter(function (item) { return item.id !== id; });
    delete graphState(pingPong.chain).positions[pingPongNodeId(id)];
    state.compileRevision++;
    mergeScannedUniforms();
    renderGraph();
    graphModified();
  }

  function pingPongById(id, pingPongs) {
    return (pingPongs || state.pingPongs).filter(function (pingPong) { return pingPong.id === id; })[0] || null;
  }

  function pingPongNodeId(id) {
    return "pingpong:" + id;
  }

  function pingPongLabel(id) {
    var match = /^pingpong-(\d+)$/.exec(id || "");
    return "Ping-Pong" + (match ? " " + match[1] : "");
  }

  function pingPongIterations(value) {
    return Math.max(1, Math.min(64, Math.round(Number(value) || 1)));
  }

  function pingPongAliasNames(pingPong, kind) {
    if (!pingPong) return [];
    var value = pingPong[kind + "Aliases"] || pingPong[kind + "Alias"];
    return Array.isArray(value) ? value : aliasNamesFromText(value || (kind === "iteration" ? "iteration, iIteration" : "phase, iPhase"));
  }

  function updatePingPongSetting(id, setting, value) {
    var pingPong = pingPongById(id);
    if (!pingPong) return;
    if (setting === "iterations") {
      var iterations = pingPongIterations(value);
      if (pingPong.iterations === iterations) return;
      pingPong.iterations = iterations;
      state.compileRevision++;
      graphModified();
      return;
    } else {
      var names = aliasNamesFromText(value);
      if (!names.length) names = [setting === "iterationAlias" ? "iteration" : "phase"];
      var aliases = names.join(", ");
      if (pingPong[setting] === aliases) return;
      pingPong[setting] = aliases;
    }
    state.compileRevision++;
    mergeScannedUniforms();
    renderGraph();
    graphModified();
  }

  function setPingPongInput(id, passIndex) {
    var pingPong = pingPongById(id);
    if (!pingPong || pingPong.from === passIndex) return;
    if (Number.isInteger(passIndex)) {
      var sourceChain = chainForPass(passIndex);
      if (sourceChain !== pingPong.chain && !(sourceChain === "model" && pingPong.chain === "post")) {
        log("Ping-Pong 写入端不能跨节点图反向连接。", "error");
        return;
      }
    }
    pingPong.from = Number.isInteger(passIndex) ? passIndex : null;
    state.compileRevision++;
    mergeScannedUniforms();
    renderGraph();
    graphModified();
  }

  var highlightedDropTarget = null;
  var lastDropSignature = "";
  var lastDropAt = 0;

  function compatibleDropPath(paths, stage) {
    var extensions = stage === "vertex" || stage === "postVertex" ? ["glsl", "vert", "vsh", "vertex"] :
      stage === "fragment" ? ["glsl", "frag", "fsh", "fragment"] :
      stage === "texture" ? ["png", "jpg", "jpeg", "webp", "bmp", "gif"] : [];
    return paths.filter(function (path) {
      return extensions.indexOf(String(path).split(/[?#]/)[0].split(".").pop().toLowerCase()) >= 0;
    })[0] || null;
  }

  function dropTargetAt(xRatio, yRatio) {
    var element = document.elementFromPoint(
      Math.max(0, Math.min(window.innerWidth - 1, xRatio * window.innerWidth)),
      Math.max(0, Math.min(window.innerHeight - 1, yRatio * window.innerHeight))
    );
    return element ? element.closest("[data-drop-stage]") : null;
  }

  function showDropTarget(target, paths) {
    clearDropTarget();
    if (!target || !compatibleDropPath(paths, target.dataset.dropStage)) return null;
    highlightedDropTarget = target;
    target.classList.add("drop-ready");
    return target;
  }

  function clearDropTarget() {
    if (highlightedDropTarget) highlightedDropTarget.classList.remove("drop-ready");
    highlightedDropTarget = null;
  }

  function handleDroppedPaths(paths, xRatio, yRatio) {
    var target = showDropTarget(dropTargetAt(xRatio, yRatio), paths);
    if (!target) {
      clearDropTarget();
      log("请将文件拖放到兼容的着色器或纹理卡片。", "error");
      return;
    }
    var stage = target.dataset.dropStage;
    var path = compatibleDropPath(paths, stage);
    var index = Number(target.dataset.dropIndex || 0);
    var textureNodeId = target.dataset.dropTextureNode || null;
    var signature = stage + ":" + index + ":" + (textureNodeId || "") + ":" + path;
    var now = performance.now();
    clearDropTarget();
    if (signature === lastDropSignature && now - lastDropAt < 500) return;
    lastDropSignature = signature;
    lastDropAt = now;
    if (stage === "texture") readDroppedTexture(path, textureNodeId);
    else readDroppedShader(path, stage, index);
  }

  function readDroppedShader(path, stage, index) {
    var previewRevision = state.previewRevision;
    var ideStage = stage === "postVertex" ? "vertex" : stage;
    ide("readFiles", null, { files: [{ path: path, stage: ideStage, slot: index }] }).then(function (response) {
      if (previewRevision !== state.previewRevision) return;
      if (response.error) throw new Error(response.error);
      if (!response.files || !response.files[0]) throw new Error("未读取到着色器文件。");
      applyShaderFile(stage, index, response.files[0]);
      log("已绑定着色器：" + response.files[0].name, "success");
    }).catch(function (error) {
      if (previewRevision === state.previewRevision) log("无法绑定拖入文件：" + error.message, "error");
    });
  }

  function readDroppedTexture(path, textureNodeId) {
    var previewRevision = state.previewRevision;
    if (!textureNodeId || !textureNodeById(textureNodeId)) {
      log("请将图片拖放到纹理卡片。", "error");
      return;
    }
    ide("readTexture", null, { path: path }).then(function (response) {
      if (previewRevision !== state.previewRevision) return;
      if (response.error) throw new Error(response.error);
      if (!response.texture) throw new Error("未读取到纹理文件。");
      return installTexture(response.texture, previewRevision, null, null, textureNodeId);
    }).catch(function (error) {
      if (previewRevision === state.previewRevision) log("无法导入拖入纹理：" + error.message, "error");
    });
  }

  function droppedPathsFromTransfer(dataTransfer) {
    var paths = [];
    Array.prototype.forEach.call(dataTransfer.files || [], function (file) {
      if (file.path) paths.push(file.path);
    });
    ["text/uri-list", "text/plain"].forEach(function (type) {
      var value = dataTransfer.getData(type);
      String(value || "").split(/\r?\n/).forEach(function (line) {
        line = line.trim();
        if (!line || line.charAt(0) === "#") return;
        if (/^file:\/\//i.test(line)) {
          try {
            var pathname = decodeURIComponent(new URL(line).pathname);
            if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
            paths.push(pathname);
          } catch (ignored) {
            return;
          }
        } else if (/^(?:[A-Za-z]:[\\/]|\\\\)/.test(line)) {
          paths.push(line);
        }
      });
    });
    return paths.filter(function (path, index) { return paths.indexOf(path) === index; });
  }

  window.shaderPreviewDragFromIde = function (paths, xRatio, yRatio) {
    showDropTarget(dropTargetAt(xRatio, yRatio), paths || []);
  };
  window.shaderPreviewDropFromIde = function (paths, xRatio, yRatio) {
    handleDroppedPaths(paths || [], xRatio, yRatio);
  };
  window.shaderPreviewClearDropTarget = clearDropTarget;

  function mergeScannedUniforms() {
    var all = [];
    if (state.vertex && state.vertex.interfaces) appendUniforms(all, state.vertex.interfaces, 0, "vertex");
    if (state.postVertex && state.postVertex.interfaces) appendUniforms(all, state.postVertex.interfaces, 0, "postVertex");
    state.fragments.forEach(function (file, passIndex) {
      if (file && file.interfaces) appendUniforms(all, file.interfaces, passIndex, "fragment");
    });
    var seen = {};
    var unique = [];
    all.forEach(function (uniform) {
      var key = shaderUniformKey(uniform.stage, uniform.pass, uniform.name);
      if (uniform.stage === "fragment" && linkedVertexUniform(uniform.name, uniform.pass)) return;
      if (isEngineUniform(uniform.name, uniform.pass, uniform.type, uniform.array) || seen[key]) return;
      seen[key] = true;
      unique.push(uniform);
      if (!isEditableUniform(uniform)) return;
      var signature = uniform.type + (uniform.array || "");
      if (matrixDimensions(uniform.type)) {
        if (state.uniformTypes[key] !== signature || !state.matrixInputs[key]) {
          state.matrixInputs[key] = defaultMatrixInput(uniform.type, uniform.name);
        }
        state.uniformTypes[key] = signature;
        uniform.matrixInput = state.matrixInputs[key];
      } else if (state.uniformTypes[key] !== signature || !state.uniforms[key]) {
        state.uniforms[key] = defaultUniform(uniform.type, uniform.name);
        state.uniformTypes[key] = signature;
      }
      if (!matrixDimensions(uniform.type)) uniform.value = state.uniforms[key];
    });
    state.scannedUniforms = unique;
    mergeVertexInputs();
    renderVertexParameters();
  }

  function isUniform(item) { return item.storage === "uniform"; }

  function linkedVertexUniform(name, passIndex) {
    var file = passIndex === state.modelPass ? state.vertex : state.postVertex;
    return !!(file && file.interfaces && file.interfaces.some(function (item) {
      return item.storage === "uniform" && item.name === name;
    }));
  }

  function appendUniforms(target, interfaces, passIndex, stage) {
    interfaces.filter(isUniform).forEach(function (item) {
      target.push({
        storage: item.storage,
        name: item.name,
        type: item.type,
        array: item.array,
        layout: item.layout,
        builtin: item.builtin,
        pass: passIndex,
        stage: stage
      });
    });
  }

  function uniformKey(passIndex, name) {
    return passIndex + ":" + name;
  }

  function shaderUniformKey(stage, passIndex, name) {
    return stage === "fragment" ? "fragment:" + passIndex + ":" + name : stage + ":" + name;
  }

  function defaultBuiltinAliases() {
    return { tick: "tick, iFrame", time: "time, iTime" };
  }

  function aliasNames(passIndex, kind) {
    var settings = state.builtinAliases || defaultBuiltinAliases();
    var value = settings[kind] || kind;
    var seen = {};
    return String(value).split(/[,，\s]+/).map(function (name) { return name.trim(); }).filter(function (name) {
      if (!/^[A-Za-z_]\w*$/.test(name) || seen[name]) return false;
      seen[name] = true;
      return true;
    });
  }

  function engineUniformKinds(name, passIndex, pingPongs) {
    var matches = [];
    if (aliasNames(passIndex, "tick").indexOf(name) >= 0) matches.push("tick");
    if (aliasNames(passIndex, "time").indexOf(name) >= 0) matches.push("time");
    (pingPongs || state.pingPongs).filter(function (pingPong) {
      return pingPong.from === passIndex;
    }).forEach(function (pingPong) {
      if (pingPongAliasNames(pingPong, "iteration").indexOf(name) >= 0) {
        matches.push("pingPongIteration:" + pingPong.id);
      }
      if (pingPongAliasNames(pingPong, "phase").indexOf(name) >= 0) {
        matches.push("pingPongPhase:" + pingPong.id);
      }
    });
    if (name === "cameraPosition") matches.push("cameraPosition");
    if (name === "resolution") matches.push("resolution");
    matches = matches.filter(function (match, index) { return matches.indexOf(match) === index; });
    return matches;
  }

  function engineUniformKind(name, passIndex, pingPongs) {
    var matches = engineUniformKinds(name, passIndex, pingPongs);
    return matches.length === 1 ? matches[0] : null;
  }

  function engineUniformTypeSupported(kind, type) {
    if (kind === "tick" || kind && kind.indexOf("pingPongIteration:") === 0 || kind && kind.indexOf("pingPongPhase:") === 0) {
      return ["float", "int", "uint", "bool"].indexOf(type) >= 0;
    }
    if (kind === "time") return type === "float";
    if (kind === "cameraPosition") return type === "vec3";
    if (kind === "resolution") return type === "vec2";
    return false;
  }

  function isEngineUniform(name, passIndex, type, array) {
    var kind = engineUniformKind(name, passIndex);
    return !array && kind !== null && engineUniformTypeSupported(kind, type);
  }

  function uniformVariableDescriptor(value, passIndex, component, pingPongs) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? { constant: value } : { error: "数值无效" };
    }
    var text = String(value || "").trim();
    if (!text) return { error: "请输入数值或变量名" };
    var numeric = Number(text);
    if (Number.isFinite(numeric)) return { constant: numeric };
    var componentMatch = /^(resolution|cameraPosition)\.([xyzwrgba])$/.exec(text);
    if (componentMatch) {
      var componentNames = { x: 0, r: 0, y: 1, g: 1, z: 2, b: 2, w: 3, a: 3 };
      var explicitComponent = componentNames[componentMatch[2]];
      var componentCount = componentMatch[1] === "resolution" ? 2 : 3;
      return explicitComponent < componentCount ? { kind: componentMatch[1], component: explicitComponent } :
        { error: "变量 '" + text + "' 没有该分量" };
    }
    if (!/^[A-Za-z_]\w*$/.test(text)) return { error: "'" + text + "' 不是可用的变量名" };
    var matches = engineUniformKinds(text, passIndex, pingPongs);
    if (text === "tick" && matches.indexOf("tick") < 0) matches.push("tick");
    if (text === "time" && matches.indexOf("time") < 0) matches.push("time");
    matches = matches.filter(function (match, index) { return matches.indexOf(match) === index; });
    if (matches.length > 1) return { error: "变量 '" + text + "' 同时匹配多个引擎来源" };
    if (!matches.length) return { error: "找不到变量 '" + text + "'" };
    var kind = matches[0];
    if (kind === "resolution" && component > 1) return { error: "resolution 只有 2 个分量" };
    if (kind === "cameraPosition" && component > 2) return { error: "cameraPosition 只有 3 个分量" };
    return { kind: kind, component: component };
  }

  function resolveUniformVariable(value, passIndex, component, pingPongs, frameTime, matrices) {
    var descriptor = uniformVariableDescriptor(value, passIndex, component, pingPongs);
    if (descriptor.error || descriptor.constant !== undefined) return descriptor;
    if (descriptor.kind === "tick") return { constant: state.tick };
    if (descriptor.kind === "time") return { constant: frameTime };
    if (descriptor.kind === "resolution") {
      return { constant: descriptor.component === 0 ? canvas.width : canvas.height };
    }
    if (descriptor.kind === "cameraPosition") {
      return { constant: matrices.eye[descriptor.component] };
    }
    if (descriptor.kind.indexOf("pingPongIteration:") === 0) {
      var iteration = pingPongById(descriptor.kind.substring("pingPongIteration:".length), pingPongs);
      return { constant: iteration ? iteration.iteration : 0 };
    }
    if (descriptor.kind.indexOf("pingPongPhase:") === 0) {
      var phase = pingPongById(descriptor.kind.substring("pingPongPhase:".length), pingPongs);
      return { constant: phase ? phase.phase : 0 };
    }
    return { error: "不支持的变量来源" };
  }

  function resolveUniformValues(values, passIndex, pingPongs, frameTime, matrices) {
    if (!values) return null;
    var cached = state.uniformValueCache.get(values);
    if (!cached || cached.length !== values.length) {
      cached = values.map(function (value) { return typeof value === "number" && Number.isFinite(value) ? value : 0; });
      state.uniformValueCache.set(values, cached);
    }
    values.forEach(function (value, component) {
      var resolved = resolveUniformVariable(value, passIndex, component, pingPongs, frameTime, matrices);
      if (!resolved.error) cached[component] = resolved.constant;
    });
    return cached;
  }

  function cacheUniformConstant(values, component, value) {
    var cached = state.uniformValueCache.get(values);
    if (!cached || cached.length !== values.length) {
      cached = values.map(function (item) {
        var numeric = Number(item);
        return Number.isFinite(numeric) ? numeric : 0;
      });
      state.uniformValueCache.set(values, cached);
    }
    cached[component] = value;
  }

  function defaultUniform(type, name) {
    if (type === "bool") return [0];
    var match = /^(?:[biu]?vec)([2-4])$/.exec(type);
    var count = match ? Number(match[1]) : 1;
    var colorLike = /color|colour|tint|albedo|diffuse|emissive/i.test(name || "");
    var result = [];
    for (var i = 0; i < count; i++) result.push(colorLike || i === 3 ? 1 : 0);
    return result;
  }

  function matrixDimensions(type) {
    var match = /^mat([2-4])(?:x([2-4]))?$/.exec(type);
    if (!match) return null;
    return { columns: Number(match[1]), rows: Number(match[2] || match[1]) };
  }

  function inferredMatrixKind(name) {
    if (["model", "modelMatrix", "modelMat", "transMat", "uModel", "uModelMatrix"].indexOf(name) >= 0) return "model";
    if (["view", "viewMatrix", "viewMat", "uView", "uViewMatrix"].indexOf(name) >= 0) return "view";
    if (["projection", "projectionMatrix", "projectionMat", "projMatrix", "projMat", "uProjection", "uProjectionMatrix"].indexOf(name) >= 0) return "projection";
    return null;
  }

  function defaultMatrixInput(type, name) {
    var dimensions = matrixDimensions(type);
    var kind = inferredMatrixKind(name);
    var value = new Array(dimensions.columns * dimensions.rows).fill(0);
    if (dimensions.columns === dimensions.rows) {
      for (var diagonal = 0; diagonal < dimensions.columns; diagonal++) {
        value[diagonal * dimensions.rows + diagonal] = 1;
      }
    }
    return {
      mode: kind && type === "mat4" ? "engine" : "manual",
      kind: kind || "model",
      value: value
    };
  }

  function isEditableUniform(uniform) {
    return !uniform.array && (/^(?:float|int|uint|bool|[biu]?vec[2-4])$/.test(uniform.type) || matrixDimensions(uniform.type));
  }

  function mergeVertexInputs() {
    [
      { stage: "vertex", file: state.vertex },
      { stage: "postVertex", file: state.postVertex }
    ].forEach(function (entry) {
      if (!entry.file || !entry.file.interfaces) return;
      entry.file.interfaces.filter(isVertexInput).forEach(function (input) {
        var key = attributeInputKey(entry.stage, input.name);
        if (!state.attributeInputs[key]) {
          state.attributeInputs[key] = { semantic: inferredAttributeSemantic(input.name, input.type) };
        }
      });
    });
  }

  function renderVertexParameters() {
    var host = document.getElementById("vertexParameters");
    if (!host) return;
    host.textContent = "";
    var count = 0;
    [
      { stage: "vertex", file: state.vertex, title: "模型顶点着色器" },
      { stage: "postVertex", file: state.postVertex, title: "后处理顶点着色器" }
    ].forEach(function (entry) {
      if (!entry.file) return;
      var inputs = (entry.file.interfaces || []).filter(isVertexInput);
      var uniforms = state.scannedUniforms.filter(function (uniform) {
        return uniform.stage === entry.stage && isEditableUniform(uniform);
      });
      count += inputs.length + uniforms.length;
      var group = document.createElement("section");
      group.className = "uniform-group";
      group.innerHTML = '<div class="uniform-group-header"><strong>' + entry.title + '</strong><small>' + escapeHtml(entry.file.name) + '</small></div>';
      inputs.forEach(function (input) { renderAttributeInput(group, entry.stage, input); });
      uniforms.forEach(function (uniform) { appendUniformEditor(group, uniform); });
      if (!inputs.length && !uniforms.length) {
        var empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "没有可配置的顶点输入或 uniform。";
        group.appendChild(empty);
      }
      host.appendChild(group);
    });
    document.getElementById("vertexParameterCount").textContent = String(count);
    if (!host.children.length) host.innerHTML = '<p class="empty">绑定顶点着色器后显示参数。</p>';
  }

  function isVertexInput(item) {
    return !item.builtin && (item.storage === "in" || item.storage === "attribute");
  }

  function attributeInputKey(stage, name) {
    return stage + ":" + name;
  }

  function inferredAttributeSemantic(name, type) {
    var normalized = String(name).toLowerCase();
    if (normalized.indexOf("normal") >= 0) return "normal";
    if (normalized.indexOf("uv") >= 0 || normalized.indexOf("tex") >= 0) return "uv";
    if (normalized.indexOf("pos") >= 0 || normalized.indexOf("vertex") >= 0) return "position";
    if (type === "vec2") return "uv";
    return "position";
  }

  function renderAttributeInput(group, stage, input) {
    var key = attributeInputKey(stage, input.name);
    var setting = state.attributeInputs[key] || { semantic: inferredAttributeSemantic(input.name, input.type) };
    state.attributeInputs[key] = setting;
    var row = document.createElement("label");
    row.className = "uniform attribute-input";
    row.innerHTML = '<span class="uniform-name"><code>' + escapeHtml(input.name) + '</code><small>in ' + escapeHtml(input.type + (input.array || "")) + '</small></span>';
    var select = document.createElement("select");
    [
      { value: "position", label: "位置" },
      { value: "normal", label: "法线" },
      { value: "uv", label: "UV" }
    ].forEach(function (choice) {
      var option = document.createElement("option");
      option.value = choice.value;
      option.textContent = choice.label;
      option.selected = setting.semantic === choice.value;
      select.appendChild(option);
    });
    select.addEventListener("change", function () {
      setting.semantic = select.value;
      invalidateGeometryVaos();
      if (stage === "postVertex") warnShaderInterfaces();
      schedulePreviewFrame();
    });
    row.appendChild(select);
    group.appendChild(row);
  }

  function appendUniformEditor(group, uniform) {
    if (matrixDimensions(uniform.type)) {
      renderMatrixUniform(group, uniform);
      return;
    }
    var row = document.createElement("div");
    row.className = "uniform";
    var values = state.uniforms[shaderUniformKey(uniform.stage, uniform.pass, uniform.name)] || defaultUniform(uniform.type, uniform.name);
    var input = document.createElement("div");
    input.className = "vector-input";
    input.style.setProperty("--components", values.length);
    values.forEach(function (value, component) {
      var element = document.createElement("input");
      element.type = "text";
      element.autocomplete = "off";
      element.spellcheck = false;
      element.value = String(value);
      element.title = "可输入数值，或绑定 tick、time 等变量";
      function updateValue(reportError) {
        values[component] = element.value.trim();
        var descriptor = uniformVariableDescriptor(values[component], uniform.pass, component);
        element.classList.toggle("invalid-value", !!descriptor.error);
        if (descriptor.error) {
          element.setAttribute("aria-invalid", "true");
          element.title = descriptor.error + "；将继续使用上一个有效值";
          if (reportError) log("参数 '" + uniform.name + "'：" + descriptor.error + "。", "error");
        } else {
          element.removeAttribute("aria-invalid");
          element.title = "可输入数值，或绑定 tick、time 等变量";
          if (descriptor.constant !== undefined) cacheUniformConstant(values, component, descriptor.constant);
        }
      }
      updateValue(false);
      element.addEventListener("input", function () { updateValue(false); schedulePreviewFrame(); });
      element.addEventListener("change", function () { updateValue(true); });
      input.appendChild(element);
    });
    row.innerHTML = '<span class="uniform-name"><code>' + escapeHtml(uniform.name) + '</code><small>' + escapeHtml(uniform.type + (uniform.array || "")) + '</small></span>';
    row.appendChild(input);
    group.appendChild(row);
  }

  function appendFragmentParameters(node, passIndex) {
    var file = state.fragments[passIndex];
    if (!file) return;
    var stageInputs = (file.interfaces || []).filter(function (item) {
      return !item.builtin && (item.storage === "in" || item.storage === "varying");
    });
    var uniforms = state.scannedUniforms.filter(function (uniform) {
      return uniform.stage === "fragment" && uniform.pass === passIndex && isEditableUniform(uniform);
    });
    if (stageInputs.length) {
      var interfaces = document.createElement("section");
      interfaces.className = "graph-interface-settings";
      interfaces.innerHTML = '<div class="graph-settings-heading"><strong>接口</strong><small>' + stageInputs.length + '</small></div>';
      stageInputs.forEach(function (input) {
        var row = document.createElement("div");
        row.className = "graph-interface-row";
        row.innerHTML = '<code>' + escapeHtml(input.name) + '</code><small>in ' + escapeHtml(input.type + (input.array || "")) + '</small>';
        interfaces.appendChild(row);
      });
      node.appendChild(interfaces);
    }
    var parameters = document.createElement("section");
    parameters.className = "graph-parameter-settings";
    parameters.innerHTML = '<div class="graph-settings-heading"><strong>参数</strong><small>' + uniforms.length + '</small></div>';
    if (!uniforms.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "没有可编辑参数。";
      parameters.appendChild(empty);
    } else {
      uniforms.forEach(function (uniform) { appendUniformEditor(parameters, uniform); });
    }
    node.appendChild(parameters);
  }

  function renderMatrixUniform(group, uniform) {
    var dimensions = matrixDimensions(uniform.type);
    var key = shaderUniformKey(uniform.stage, uniform.pass, uniform.name);
    var setting = state.matrixInputs[key] || defaultMatrixInput(uniform.type, uniform.name);
    state.matrixInputs[key] = setting;
    var row = document.createElement("div");
    row.className = "uniform matrix-uniform";
    row.innerHTML = '<div class="uniform-name"><code>' + escapeHtml(uniform.name) + '</code><small>' + escapeHtml(uniform.type) + '</small></div>';

    var editor = document.createElement("div");
    editor.className = "matrix-editor";
    var modes = document.createElement("div");
    modes.className = "segmented matrix-mode";
    [
      { value: "engine", label: "引擎矩阵" },
      { value: "manual", label: "手动输入" }
    ].forEach(function (mode) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = mode.label;
      button.classList.toggle("active", setting.mode === mode.value);
      if (mode.value === "engine" && uniform.type !== "mat4") {
        button.disabled = true;
        button.title = "引擎矩阵仅提供 mat4";
      }
      button.addEventListener("click", function () {
        setting.mode = mode.value;
        renderUniformsFromState();
        schedulePreviewFrame();
      });
      modes.appendChild(button);
    });
    editor.appendChild(modes);

    if (setting.mode === "engine" && uniform.type === "mat4") {
      var source = document.createElement("select");
      [
        { value: "model", label: "模型矩阵" },
        { value: "view", label: "视图矩阵" },
        { value: "projection", label: "投影矩阵" }
      ].forEach(function (optionValue) {
        var option = document.createElement("option");
        option.value = optionValue.value;
        option.textContent = optionValue.label;
        option.selected = setting.kind === optionValue.value;
        source.appendChild(option);
      });
      source.addEventListener("change", function () { setting.kind = source.value; schedulePreviewFrame(); });
      editor.appendChild(source);
    } else {
      var grid = document.createElement("div");
      grid.className = "matrix-grid";
      grid.style.setProperty("--matrix-columns", dimensions.columns);
      for (var matrixRow = 0; matrixRow < dimensions.rows; matrixRow++) {
        for (var column = 0; column < dimensions.columns; column++) {
          (function (component) {
            var input = document.createElement("input");
            input.type = "number";
            input.step = "0.01";
            input.value = String(setting.value[component]);
            input.title = "第 " + (matrixRow + 1) + " 行，第 " + (column + 1) + " 列";
            input.addEventListener("input", function () { setting.value[component] = Number(input.value) || 0; schedulePreviewFrame(); });
            grid.appendChild(input);
          })(column * dimensions.rows + matrixRow);
        }
      }
      editor.appendChild(grid);
    }
    row.appendChild(editor);
    group.appendChild(row);
  }

  function renderUniformsFromState() {
    mergeScannedUniforms();
    renderGraph();
  }

  function aliasNamesFromText(value) {
    var seen = {};
    return String(value).split(/[,，\s]+/).map(function (name) { return name.trim(); }).filter(function (name) {
      if (!/^[A-Za-z_]\w*$/.test(name) || seen[name]) return false;
      seen[name] = true;
      return true;
    });
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function normalizeSource(source, stage) {
    var result = String(source || "").replace(/^\s*#version[^\n]*\n?/m, "#version 300 es\n");
    if (!/^\s*#version/m.test(result)) result = "#version 300 es\n" + result;
    var declarations = [];
    if (!/precision\s+(?:lowp|mediump|highp)\s+float\s*;/.test(result)) declarations.push("precision highp float;");
    if (!/precision\s+(?:lowp|mediump|highp)\s+int\s*;/.test(result)) declarations.push("precision highp int;");
    if (stage === "vertex") {
      result = result.replace(/\battribute\b/g, "in").replace(/\bvarying\b/g, "out");
    } else {
      result = result.replace(/\bvarying\b/g, "in");
      if (/\bgl_FragColor\b/.test(result)) {
        declarations.push("out highp vec4 previewFragColor;");
        result = result.replace(/\bgl_FragColor\b/g, "previewFragColor");
      }
      result = result.replace(/\btexture2D\s*\(/g, "texture(");
    }
    if (declarations.length) result = insertAfterShaderPreamble(result, declarations.join("\n") + "\n");
    return result;
  }

  function insertAfterShaderPreamble(source, declarations) {
    var lines = source.split("\n");
    var offset = 0;
    var inBlockComment = false;
    for (var index = 0; index < lines.length; index++) {
      var trimmed = lines[index].trim();
      var preambleLine = index === 0 && /^#version\b/.test(trimmed);
      if (inBlockComment) {
        preambleLine = true;
        if (trimmed.indexOf("*/") >= 0) inBlockComment = false;
      } else if (!trimmed || /^\/\//.test(trimmed) || /^#/.test(trimmed) || /^precision\b[^;]*;/.test(trimmed)) {
        preambleLine = true;
      } else if (/^\/\*/.test(trimmed)) {
        preambleLine = true;
        inBlockComment = trimmed.indexOf("*/") < 0;
      }
      if (!preambleLine) break;
      offset += lines[index].length + 1;
    }
    return source.slice(0, offset) + declarations + source.slice(offset);
  }

  function compileProgram(vertexSource, fragmentSource, label) {
    var vertex = null;
    var fragment = null;
    var program = null;
    try {
      vertex = compileShader(gl.VERTEX_SHADER, normalizeSource(vertexSource, "vertex"), label + "顶点着色器");
      fragment = compileShader(gl.FRAGMENT_SHADER, normalizeSource(fragmentSource, "fragment"), label + "片元着色器");
      program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(label + "链接失败：\n" + (gl.getProgramInfoLog(program) || "未知链接错误"));
      }
      return program;
    } catch (error) {
      if (program) gl.deleteProgram(program);
      throw error;
    } finally {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    }
  }

  function compileShader(type, source, label) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var shaderLog = gl.getShaderInfoLog(shader) || "未知编译错误";
      gl.deleteShader(shader);
      throw new Error(label + "编译失败：\n" + shaderLog);
    }
    return shader;
  }

  function compileAll(automatic) {
    automatic = automatic === true;
    if (!automatic) {
      if (state.autoCompileTimer !== null) clearTimeout(state.autoCompileTimer);
      state.autoCompileTimer = null;
      state.autoCompileBlocked = false;
    }
    var revision = ++state.compileRevision;
    var files = [];
    if (state.vertex) files.push({ path: state.vertex.path, stage: "vertex", slot: -1 });
    if (state.postVertex) files.push({ path: state.postVertex.path, stage: "postVertex", slot: -2 });
    state.fragments.forEach(function (file, slot) {
      if (file) files.push({ path: file.path, stage: "fragment", slot: slot });
    });
    if (!files.length) {
      compileFresh(revision, automatic);
      return;
    }
    state.readingRevision = revision;
    setStatus("读取中", "idle");
    ide("readFiles", null, { files: files }).then(function (response) {
      if (revision !== state.compileRevision) {
        finishStaleRead(revision);
        return;
      }
      state.readingRevision = null;
      if (response.error) throw new Error(response.error);
      (response.files || []).forEach(function (file) {
        if (file.stage === "vertex" || file.slot === -1) state.vertex = file;
        else if (file.stage === "postVertex" || file.slot === -2) state.postVertex = file;
        else if (file.stage === "fragment" && file.slot !== null) state.fragments[file.slot] = file;
      });
      mergeScannedUniforms();
      renderPassSlots();
      renderGraph();
      warnShaderInterfaces();
      compileFresh(revision, automatic);
    }).catch(function (error) {
      if (revision !== state.compileRevision) {
        finishStaleRead(revision);
        return;
      }
      state.readingRevision = null;
      blockAutoCompile(automatic);
      log("无法读取当前着色器源码：" + error.message, "error");
      setStatus("需手动编译", "error");
    });
  }

  function finishStaleRead(revision) {
    if (state.readingRevision !== revision) return;
    state.readingRevision = null;
    setStatus(state.passes.length ? "待重新编译" : "待编译", "idle");
  }

  function compileFresh(revision, automatic) {
    if (revision !== state.compileRevision) return;
    if (!gl) {
      blockAutoCompile(automatic);
      log("当前 JCEF 运行环境不支持 WebGL2。", "error");
      setStatus("不可用", "error");
      return;
    }
    var fragments = state.fragments;
    if (!fragments.length || !fragments[0]) {
      blockAutoCompile(automatic);
      log("请至少绑定一个片元着色器后再编译。", "error");
      setStatus("配置不完整", "error");
      return;
    }
    if (fragments.some(function (file) { return !file; })) {
      blockAutoCompile(automatic);
      log("请先绑定所有片元通道，再编译渲染图。", "error");
      setStatus("配置不完整", "error");
      return;
    }
    connectDefaultPasses();
    var candidate = [];
    var candidateConnections = [];
    var candidatePingPongs = [];
    try {
      fragments.forEach(function (file, index) {
        var usesModel = index === state.modelPass;
        var usesCustomPostVertex = !usesModel && !!state.postVertex;
        if (usesCustomPostVertex) validatePostVertexUvInput();
        var vertexSource = usesModel ? (state.vertex ? state.vertex.source : defaultVertex) :
          usesCustomPostVertex ? state.postVertex.source : fullscreenVertex();
        var program = compileProgram(vertexSource, file.source, "通道 " + (index + 1) + " ");
        var target = null;
        try {
          validateVertexAttributes(program, index);
          var reflection = reflectProgram(program, index);
          var writesPingPong = state.pingPongs.some(function (pingPong) { return pingPong.from === index; });
          var feedsLaterPass = state.connections.some(function (connection) { return connection.from === index; });
          target = index !== state.outputPass || writesPingPong || feedsLaterPass ? createTarget(usesModel) : null;
          if (target) resizeTarget(target, Math.max(1, canvas.width), Math.max(1, canvas.height));
        } catch (targetError) {
          gl.deleteProgram(program);
          if (target) disposePass({ target: target });
          throw targetError;
        }
        candidate.push({
          program: program,
          target: target,
          file: file,
          source: file.source,
          usesModel: usesModel,
          usesCustomPostVertex: usesCustomPostVertex,
          attributeInputs: captureAttributeInputs(program, usesModel ? "vertex" : "postVertex"),
          uniforms: reflection.uniforms,
          values: captureUniformValues(reflection.uniforms, index),
          matrixInputs: captureMatrixInputs(reflection.uniforms, index),
          samplers: mergeSamplerInputs(file, reflection.samplers),
          output: reflection.output
        });
      });
      candidateConnections = validateCandidate(candidate);
      candidatePingPongs = state.pingPongs.map(createPingPongRuntime);
      clearGlErrors();
      getBlackTexture();
      clearGlErrors();
      renderPasses(candidate, candidateConnections, candidatePingPongs, false, state.outputPass, true);
      candidatePingPongs.forEach(resetPingPongRuntime);
      var renderError = gl.getError();
      if (renderError !== gl.NO_ERROR) {
        throw new Error("候选版本渲染失败，WebGL 错误 0x" + renderError.toString(16) + "。");
      }
    } catch (error) {
      candidate.forEach(disposePass);
      candidatePingPongs.forEach(disposePingPongRuntime);
      if (state.passes.length) {
        try {
          clearGlErrors();
          renderPasses(state.passes, state.activeConnections, state.activePingPongs, false, state.activeOutputPass);
          clearGlErrors();
        } catch (ignored) {
          // The compile error remains the actionable failure.
        }
      }
      blockAutoCompile(automatic);
      log(error.message + "\n已保留上一个可用版本。", "error");
      setStatus("需手动编译", "error");
      return;
    }
    state.passes.forEach(disposePass);
    state.activePingPongs.forEach(disposePingPongRuntime);
    state.passes = candidate;
    state.connections = candidateConnections.map(function (connection) {
      return {
        from: connection.from,
        texture: connection.texture,
        textureNode: connection.textureNode,
        pingPong: connection.pingPong,
        to: connection.to,
        input: connection.input
      };
    });
    state.activeConnections = candidateConnections;
    state.activePingPongs = candidatePingPongs;
    state.activeOutputPass = state.outputPass;
    disposeRetiredTextures();
    state.autoCompileBlocked = false;
    state.tick = 0;
    state.startedAt = performance.now();
    state.paused = false;
    state.pausedAt = null;
    state.runtimeErrorLogged = false;
    lastRuntimeErrorCheck = performance.now();
    schedulePreviewFrame();
    document.getElementById("pause").textContent = "II";
    document.getElementById("pause").classList.remove("resume");
    document.getElementById("canvasMessage").classList.add("hidden");
    log("已编译 " + candidate.length + " 个通道。", "success");
    setStatus("运行中", "running");
    renderGraph();
  }

  function validateCandidate(candidate) {
    var connections = [];
    state.pingPongs.forEach(function (pingPong) {
      if (pingPong.from === null) return;
      if (!Number.isInteger(pingPong.from) || pingPong.from < 0 || pingPong.from >= candidate.length) {
        throw new Error(pingPongLabel(pingPong.id) + " 连接了无效的片元通道输出。");
      }
      if (!candidate[pingPong.from].output.supported) {
        throw new Error(pingPongLabel(pingPong.id) + " 的输入通道没有可用输出。");
      }
    });
    candidate.forEach(function (pass, passIndex) {
      if (!pass.output.supported) {
        throw new Error("通道 " + (passIndex + 1) + " 的输出 '" + pass.output.name + "' 不受支持：" + pass.output.reason + "。");
      }
      pass.samplers.forEach(function (sampler) {
        if (!sampler.supported) {
          throw new Error("通道 " + (passIndex + 1) + " 的采样器 '" + sampler.name + "' 使用了不支持的类型 " + sampler.type + "。");
        }
        var connection = connectionSetting(passIndex, sampler.name);
        if (connection && connection.textureNode) {
          var textureNode = textureNodeById(connection.textureNode);
          var texture = textureNode && textureById(textureNode.texture);
          if (!texture || !texture.glTexture) {
            throw new Error("通道 " + (passIndex + 1) + " 的采样器 '" + sampler.name + "' 连接了无效纹理。");
          }
          connections.push({
            textureNode: textureNode.id,
            texture: texture.id,
            glTexture: texture.glTexture,
            to: passIndex,
            input: sampler.name
          });
          return;
        }
        if (connection && connection.pingPong) {
          var pingPong = pingPongById(connection.pingPong);
          if (!pingPong || !Number.isInteger(pingPong.from)) {
            throw new Error("通道 " + (passIndex + 1) + " 的采样器 '" + sampler.name + "' 连接了未配置的 Ping-Pong。");
          }
          connections.push({ pingPong: pingPong.id, to: passIndex, input: sampler.name });
          return;
        }
        if (!connection) return;
        if (connection.from < 0 || connection.from >= passIndex || !candidate[connection.from].target) {
          throw new Error("通道 " + (passIndex + 1) + " 的采样器 '" + sampler.name + "' 连接了无效的上游通道。");
        }
        connections.push({ from: connection.from, to: passIndex, input: sampler.name });
      });
    });
    return connections;
  }

  function captureUniformValues(uniforms, passIndex) {
    var values = {};
    uniforms.forEach(function (uniform) {
      var definition = uniformDefinitionForProgram(uniform.name, passIndex);
      if (!definition || matrixDimensions(definition.type)) return;
      var value = state.uniforms[shaderUniformKey(definition.stage, definition.pass, definition.name)];
      if (value) values[uniform.name] = value;
    });
    return values;
  }

  function captureMatrixInputs(uniforms, passIndex) {
    var inputs = {};
    uniforms.forEach(function (uniform) {
      var definition = uniformDefinitionForProgram(uniform.name, passIndex);
      if (!definition || !matrixDimensions(definition.type)) return;
      var input = state.matrixInputs[shaderUniformKey(definition.stage, definition.pass, definition.name)];
      if (input) inputs[uniform.name] = input;
    });
    return inputs;
  }

  function uniformDefinitionForProgram(name, passIndex) {
    var vertex = state.vertex && state.vertex.interfaces ? state.vertex.interfaces.filter(function (item) {
      return item.storage === "uniform" && item.name === name;
    })[0] : null;
    if (vertex && passIndex === state.modelPass) {
      return { stage: "vertex", pass: 0, name: name, type: vertex.type };
    }
    var postVertex = state.postVertex && state.postVertex.interfaces ? state.postVertex.interfaces.filter(function (item) {
      return item.storage === "uniform" && item.name === name;
    })[0] : null;
    if (postVertex && passIndex !== state.modelPass) {
      return { stage: "postVertex", pass: 0, name: name, type: postVertex.type };
    }
    var fragment = state.fragments[passIndex];
    var item = fragment && fragment.interfaces ? fragment.interfaces.filter(function (candidate) {
      return candidate.storage === "uniform" && candidate.name === name;
    })[0] : null;
    return item ? { stage: "fragment", pass: passIndex, name: name, type: item.type } : null;
  }

  function clearGlErrors() {
    for (var attempt = 0; attempt < 16 && gl.getError() !== gl.NO_ERROR; attempt++) {
      // Drain errors left by the previous frame before validating a candidate.
    }
  }

  function fullscreenVertex() {
    return "#version 300 es\nprecision highp float;\nout vec2 vUv;\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=p;gl_Position=vec4(p*2.0-1.0,0.0,1.0);}";
  }

  function validatePostVertexUvInput() {
    var inputs = state.postVertex && state.postVertex.interfaces ? state.postVertex.interfaces.filter(isVertexInput) : [];
    var hasUv = inputs.some(function (input) {
      var setting = state.attributeInputs[attributeInputKey("postVertex", input.name)];
      return setting && setting.semantic === "uv";
    });
    if (!hasUv) throw new Error("自定义后处理顶点着色器必须提供一个映射为 UV 的输入。");
  }

  function captureAttributeInputs(program, stage) {
    var inputs = {};
    var count = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for (var index = 0; index < count; index++) {
      var active = gl.getActiveAttrib(program, index);
      if (!active) continue;
      var key = attributeInputKey(stage, active.name);
      inputs[active.name] = state.attributeInputs[key] || {
        semantic: inferredAttributeSemantic(active.name, uniformTypeName(active.type))
      };
    }
    return inputs;
  }

  function validateVertexAttributes(program, passIndex) {
    var supported = [gl.FLOAT, gl.FLOAT_VEC2, gl.FLOAT_VEC3, gl.FLOAT_VEC4];
    var count = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for (var index = 0; index < count; index++) {
      var active = gl.getActiveAttrib(program, index);
      if (!active || supported.indexOf(active.type) >= 0 && active.size === 1) continue;
      var type = uniformTypeName(active.type) + (active.size > 1 ? "[" + active.size + "]" : "");
      throw new Error("通道 " + (passIndex + 1) + " 的顶点输入 '" + active.name.replace(/\[0\]$/, "") + "' 类型为 " + type + "；预览模型目前只支持 float、vec2、vec3 和 vec4 输入。");
    }
  }

  function reflectProgram(program, passIndex) {
    var uniforms = [];
    var samplers = [];
    var uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var index = 0; index < uniformCount; index++) {
      var active = gl.getActiveUniform(program, index);
      if (!active) continue;
      var uniform = {
        name: active.name.replace(/\[0\]$/, ""),
        type: active.type,
        size: active.size,
        location: null
      };
      uniform.location = gl.getUniformLocation(program, uniform.name);
      uniforms.push(uniform);
      if (isSampler(active.type)) {
        samplers.push({
          name: uniform.name,
          type: uniformTypeName(active.type) + (active.size > 1 ? "[" + active.size + "]" : ""),
          supported: active.type === gl.SAMPLER_2D && active.size === 1
        });
      }
      validateEngineUniform(uniform, passIndex);
    }

    var output = passOutputFromSource(passIndex);
    if (output.supported) {
      var actualLocation = gl.getFragDataLocation(program, output.name);
      output.location = actualLocation;
      if (actualLocation < 0) {
        output.supported = false;
        output.reason = "片元输出未激活";
      } else if (actualLocation !== 0) {
        output.supported = false;
        output.reason = "不支持输出位置 " + actualLocation;
      }
    }
    return { uniforms: uniforms, samplers: samplers, output: output };
  }

  function passOutputFromSource(passIndex) {
    var file = state.fragments[passIndex];
    return describePassOutput(file);
  }

  function describePassOutput(file) {
    var outputs = file && file.interfaces ? file.interfaces.filter(function (item) {
      return item.storage === "out";
    }) : [];
    if (outputs.length > 1) {
      return {
        name: outputs[0].name,
        type: "multiple",
        location: 0,
        supported: false,
        reason: "暂不支持多个片元输出"
      };
    }
    if (!outputs.length) {
      var source = String(file && file.source || "");
      if (/\bgl_FragColor\b/.test(source)) {
        return { name: "previewFragColor", type: "vec4", location: 0, supported: true, reason: "" };
      }
      var fallback = /\bout\s+(?:(?:lowp|mediump|highp)\s+)?vec4\s+([A-Za-z_]\w*)/.exec(source);
      if (fallback) {
        return { name: fallback[1], type: "vec4", location: 0, supported: true, reason: "" };
      }
      return { name: "颜色 0", type: "none", location: 0, supported: false, reason: "缺少 vec4 片元输出" };
    }
    var output = outputs[0];
    var layout = output.layout || {};
    var location = layout.location === undefined ? 0 : Number(layout.location);
    var type = output.type + (output.array || "");
    return {
      name: output.name,
      type: type,
      location: location,
      supported: location === 0 && type === "vec4",
      reason: location !== 0 ? "不支持输出位置 " + location : "不支持 " + type + " 类型"
    };
  }

  function validateEngineUniform(uniform, passIndex) {
    var kind = engineUniformKind(uniform.name, passIndex);
    var definition = uniformDefinitionForProgram(uniform.name, passIndex);
    var matrixInput = definition && matrixDimensions(definition.type) ?
      state.matrixInputs[shaderUniformKey(definition.stage, definition.pass, definition.name)] : null;
    var expected = null;
    if (kind === "tick" || kind && kind.indexOf("pingPongIteration:") === 0) expected = [gl.FLOAT, gl.INT, gl.UNSIGNED_INT, gl.BOOL];
    else if (kind === "time") expected = [gl.FLOAT];
    else if (kind && kind.indexOf("pingPongPhase:") === 0) expected = [gl.FLOAT, gl.INT, gl.UNSIGNED_INT, gl.BOOL];
    else if (matrixInput && matrixInput.mode === "engine") expected = [gl.FLOAT_MAT4];
    else if (kind === "cameraPosition") expected = [gl.FLOAT_VEC3];
    else if (kind === "resolution") expected = [gl.FLOAT_VEC2];
    if (expected && (expected.indexOf(uniform.type) < 0 || uniform.size !== 1)) {
      var actual = uniformTypeName(uniform.type) + (uniform.size > 1 ? "[" + uniform.size + "]" : "");
      log("通道 " + (passIndex + 1) + " 的内置 uniform '" + uniform.name + "' 类型为 " + actual + "，将作为普通参数处理。", "warning");
    }
  }

  function uniformTypeName(type) {
    var names = {};
    names[gl.FLOAT] = "float";
    names[gl.INT] = "int";
    names[gl.UNSIGNED_INT] = "uint";
    names[gl.BOOL] = "bool";
    names[gl.FLOAT_VEC2] = "vec2";
    names[gl.FLOAT_VEC3] = "vec3";
    names[gl.FLOAT_VEC4] = "vec4";
    names[gl.INT_VEC2] = "ivec2";
    names[gl.INT_VEC3] = "ivec3";
    names[gl.INT_VEC4] = "ivec4";
    names[gl.UNSIGNED_INT_VEC2] = "uvec2";
    names[gl.UNSIGNED_INT_VEC3] = "uvec3";
    names[gl.UNSIGNED_INT_VEC4] = "uvec4";
    names[gl.BOOL_VEC2] = "bvec2";
    names[gl.BOOL_VEC3] = "bvec3";
    names[gl.BOOL_VEC4] = "bvec4";
    names[gl.FLOAT_MAT2] = "mat2";
    names[gl.FLOAT_MAT3] = "mat3";
    names[gl.FLOAT_MAT4] = "mat4";
    names[gl.FLOAT_MAT2x3] = "mat2x3";
    names[gl.FLOAT_MAT2x4] = "mat2x4";
    names[gl.FLOAT_MAT3x2] = "mat3x2";
    names[gl.FLOAT_MAT3x4] = "mat3x4";
    names[gl.FLOAT_MAT4x2] = "mat4x2";
    names[gl.FLOAT_MAT4x3] = "mat4x3";
    names[gl.SAMPLER_2D] = "sampler2D";
    names[gl.SAMPLER_3D] = "sampler3D";
    names[gl.INT_SAMPLER_2D] = "isampler2D";
    names[gl.UNSIGNED_INT_SAMPLER_2D] = "usampler2D";
    names[gl.SAMPLER_CUBE] = "samplerCube";
    names[gl.SAMPLER_2D_SHADOW] = "sampler2DShadow";
    names[gl.SAMPLER_CUBE_SHADOW] = "samplerCubeShadow";
    names[gl.SAMPLER_2D_ARRAY] = "sampler2DArray";
    names[gl.SAMPLER_2D_ARRAY_SHADOW] = "sampler2DArrayShadow";
    names[gl.INT_SAMPLER_3D] = "isampler3D";
    names[gl.INT_SAMPLER_CUBE] = "isamplerCube";
    names[gl.INT_SAMPLER_2D_ARRAY] = "isampler2DArray";
    names[gl.UNSIGNED_INT_SAMPLER_3D] = "usampler3D";
    names[gl.UNSIGNED_INT_SAMPLER_CUBE] = "usamplerCube";
    names[gl.UNSIGNED_INT_SAMPLER_2D_ARRAY] = "usampler2DArray";
    return names[type] || "GL enum " + type;
  }

  function createTarget(withDepth) {
    clearGlErrors();
    var texture = gl.createTexture();
    if (!texture) throw new Error("无法创建通道颜色纹理。");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var framebuffer = gl.createFramebuffer();
    if (!framebuffer) {
      gl.deleteTexture(texture);
      throw new Error("无法创建通道帧缓冲。");
    }
    var depth = null;
    if (withDepth) {
      depth = gl.createRenderbuffer();
      if (!depth) {
        gl.deleteFramebuffer(framebuffer);
        gl.deleteTexture(texture);
        throw new Error("无法创建通道深度缓冲。");
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (depth) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    }
    var setupError = gl.getError();
    if (setupError !== gl.NO_ERROR) {
      if (depth) gl.deleteRenderbuffer(depth);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw new Error("创建通道帧缓冲失败，WebGL 错误 0x" + setupError.toString(16) + "。");
    }
    return { texture: texture, framebuffer: framebuffer, depth: depth, width: 0, height: 0 };
  }

  function resizeTarget(target, width, height) {
    if (!target || (target.width === width && target.height === height)) return;
    target.width = 0;
    target.height = 0;
    clearGlErrors();
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    if (target.depth) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, target.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    }
    var allocationError = gl.getError();
    if (allocationError !== gl.NO_ERROR) {
      throw new Error("分配通道帧缓冲失败（" + width + " x " + height + "），WebGL 错误 0x" + allocationError.toString(16) + "。");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("通道帧缓冲不完整（" + width + " x " + height + "）。");
    }
    target.width = width;
    target.height = height;
  }

  function clearTarget(target) {
    if (!target) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  function disposeTarget(target) {
    if (!target || !gl) return;
    gl.deleteTexture(target.texture);
    gl.deleteFramebuffer(target.framebuffer);
    if (target.depth) gl.deleteRenderbuffer(target.depth);
  }

  function createPingPongRuntime(config) {
    var runtime = {
      id: config.id,
      from: config.from,
      iterations: pingPongIterations(config.iterations),
      iterationAliases: pingPongAliasNames(config, "iteration"),
      phaseAliases: pingPongAliasNames(config, "phase"),
      iteration: 0,
      phase: 0,
      ping: null,
      pong: null,
      read: null,
      write: null
    };
    if (!Number.isInteger(config.from)) return runtime;
    try {
      runtime.ping = createTarget(false);
      runtime.pong = createTarget(false);
      runtime.read = runtime.pong;
      runtime.write = runtime.ping;
      resizePingPongRuntime(runtime, Math.max(1, canvas.width), Math.max(1, canvas.height));
      return runtime;
    } catch (error) {
      disposePingPongRuntime(runtime);
      throw error;
    }
  }

  function resizePingPongRuntime(runtime, width, height) {
    if (!runtime.read || !runtime.write) return;
    var readChanged = runtime.read.width !== width || runtime.read.height !== height;
    var writeChanged = runtime.write.width !== width || runtime.write.height !== height;
    resizeTarget(runtime.read, width, height);
    resizeTarget(runtime.write, width, height);
    if (readChanged) clearTarget(runtime.read);
    if (writeChanged) clearTarget(runtime.write);
  }

  function resetPingPongRuntime(runtime) {
    clearTarget(runtime.ping);
    clearTarget(runtime.pong);
    runtime.read = runtime.pong;
    runtime.write = runtime.ping;
    runtime.iteration = 0;
    runtime.phase = 0;
  }

  function disposePingPongRuntime(runtime) {
    if (!runtime) return;
    disposeTarget(runtime.ping);
    disposeTarget(runtime.pong);
    runtime.ping = null;
    runtime.pong = null;
    runtime.read = null;
    runtime.write = null;
  }

  function disposePass(pass) {
    if (!pass || !gl) return;
    if (pass.program) {
      Object.keys(geometryCache).forEach(function (key) {
        var geometry = geometryCache[key];
        var vao = geometry.vaos.get(pass.program);
        if (vao) {
          gl.deleteVertexArray(vao);
          geometry.vaos.delete(pass.program);
        }
      });
      gl.deleteProgram(pass.program);
    }
    if (pass.target) {
      disposeTarget(pass.target);
    }
  }

  function bindUniforms(pass, index, matrices, outputs, connections, pingPongs, frameTime) {
    var textureUnit = 0;
    for (var i = 0; i < pass.uniforms.length; i++) {
      var active = pass.uniforms[i];
      var name = active.name;
      var location = active.location;
      if (location === null) continue;
      if (active.size !== 1) continue;
      var matrixInput = pass.matrixInputs && pass.matrixInputs[name];
      if (matrixInput) {
        applyMatrixInput(location, active.type, matrixInput, matrices);
        continue;
      }
      var builtin = engineUniformKind(name, index, pingPongs);
      if (builtin && !engineUniformTypeSupported(builtin, uniformTypeName(active.type))) builtin = null;
      if (builtin === "tick") { setTick(location, active.type); continue; }
      if (builtin === "time") { if (active.type === gl.FLOAT) gl.uniform1f(location, frameTime); continue; }
      if (builtin && builtin.indexOf("pingPongIteration:") === 0) {
        var iterationPingPong = pingPongById(builtin.substring("pingPongIteration:".length), pingPongs);
        setIntegerLikeUniform(location, active.type, iterationPingPong ? iterationPingPong.iteration : 0);
        continue;
      }
      if (builtin && builtin.indexOf("pingPongPhase:") === 0) {
        var phasePingPong = pingPongById(builtin.substring("pingPongPhase:".length), pingPongs);
        setIntegerLikeUniform(location, active.type, phasePingPong ? phasePingPong.phase : 0);
        continue;
      }
      if (builtin === "resolution") { if (active.type === gl.FLOAT_VEC2) gl.uniform2f(location, canvas.width, canvas.height); continue; }
      if (builtin === "cameraPosition") { if (active.type === gl.FLOAT_VEC3) gl.uniform3fv(location, matrices.eye); continue; }
      if (isSampler(active.type)) {
        if (active.type !== gl.SAMPLER_2D) continue;
        var connection = findConnection(connections, index, name);
        var texture = getBlackTexture();
        if (connection && connection.texture) {
          var imported = textureById(connection.texture);
          texture = connection.glTexture || (imported ? imported.glTexture : getBlackTexture());
        } else if (connection && connection.pingPong) {
          var pingPong = pingPongById(connection.pingPong, pingPongs);
          texture = pingPong && pingPong.read ? pingPong.read.texture : getBlackTexture();
        } else if (connection) {
          texture = outputs[connection.from] || null;
        }
        gl.activeTexture(gl.TEXTURE0 + textureUnit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(location, textureUnit++);
        continue;
      }
      applyValue(location, active.type, resolveUniformValues(pass.values[name], index, pingPongs, frameTime, matrices));
    }
  }

  function getBlackTexture() {
    if (blackTexture) return blackTexture;
    var texture = gl.createTexture();
    if (!texture) throw new Error("无法创建默认黑色纹理。");
    var previous = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    var error = gl.getError();
    gl.bindTexture(gl.TEXTURE_2D, previous);
    if (error !== gl.NO_ERROR) {
      gl.deleteTexture(texture);
      throw new Error("创建默认黑色纹理失败，WebGL 错误 0x" + error.toString(16) + "。");
    }
    blackTexture = texture;
    return blackTexture;
  }

  function setTick(location, type) {
    setIntegerLikeUniform(location, type, state.tick);
  }

  function setIntegerLikeUniform(location, type, value) {
    if (type === gl.UNSIGNED_INT) gl.uniform1ui(location, value >>> 0);
    else if (type === gl.INT || type === gl.BOOL) gl.uniform1i(location, value | 0);
    else if (type === gl.FLOAT) gl.uniform1f(location, value);
  }

  function isSampler(type) {
    return [
      gl.SAMPLER_2D,
      gl.SAMPLER_3D,
      gl.SAMPLER_CUBE,
      gl.SAMPLER_2D_SHADOW,
      gl.SAMPLER_CUBE_SHADOW,
      gl.SAMPLER_2D_ARRAY,
      gl.SAMPLER_2D_ARRAY_SHADOW,
      gl.INT_SAMPLER_2D,
      gl.INT_SAMPLER_3D,
      gl.INT_SAMPLER_CUBE,
      gl.INT_SAMPLER_2D_ARRAY,
      gl.UNSIGNED_INT_SAMPLER_2D,
      gl.UNSIGNED_INT_SAMPLER_3D,
      gl.UNSIGNED_INT_SAMPLER_CUBE,
      gl.UNSIGNED_INT_SAMPLER_2D_ARRAY
    ].indexOf(type) >= 0;
  }

  function applyValue(location, type, value) {
    if (!value) return;
    if (type === gl.FLOAT) gl.uniform1f(location, value[0]);
    else if (type === gl.FLOAT_VEC2) gl.uniform2fv(location, value);
    else if (type === gl.FLOAT_VEC3) gl.uniform3fv(location, value);
    else if (type === gl.FLOAT_VEC4) gl.uniform4fv(location, value);
    else if (type === gl.INT || type === gl.BOOL) gl.uniform1i(location, value[0] | 0);
    else if (type === gl.INT_VEC2 || type === gl.BOOL_VEC2) gl.uniform2iv(location, value);
    else if (type === gl.INT_VEC3 || type === gl.BOOL_VEC3) gl.uniform3iv(location, value);
    else if (type === gl.INT_VEC4 || type === gl.BOOL_VEC4) gl.uniform4iv(location, value);
    else if (type === gl.UNSIGNED_INT) gl.uniform1ui(location, value[0] >>> 0);
    else if (type === gl.UNSIGNED_INT_VEC2) gl.uniform2uiv(location, value);
    else if (type === gl.UNSIGNED_INT_VEC3) gl.uniform3uiv(location, value);
    else if (type === gl.UNSIGNED_INT_VEC4) gl.uniform4uiv(location, value);
  }

  function applyMatrixInput(location, type, input, matrices) {
    if (input.mode === "engine") {
      if (type === gl.FLOAT_MAT4 && matrices[input.kind]) gl.uniformMatrix4fv(location, false, matrices[input.kind]);
      return;
    }
    var methods = {};
    methods[gl.FLOAT_MAT2] = "uniformMatrix2fv";
    methods[gl.FLOAT_MAT3] = "uniformMatrix3fv";
    methods[gl.FLOAT_MAT4] = "uniformMatrix4fv";
    methods[gl.FLOAT_MAT2x3] = "uniformMatrix2x3fv";
    methods[gl.FLOAT_MAT2x4] = "uniformMatrix2x4fv";
    methods[gl.FLOAT_MAT3x2] = "uniformMatrix3x2fv";
    methods[gl.FLOAT_MAT3x4] = "uniformMatrix3x4fv";
    methods[gl.FLOAT_MAT4x2] = "uniformMatrix4x2fv";
    methods[gl.FLOAT_MAT4x3] = "uniformMatrix4x3fv";
    if (methods[type]) gl[methods[type]](location, false, input.value);
  }

  function currentTime() {
    if (document.getElementById("timeSource").value === "clock") {
      var now = new Date();
      return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
    }
    var now = state.pausedAt === null ? performance.now() : state.pausedAt;
    return (now - state.startedAt) / 1000;
  }

  function renderPasses(passes, connections, pingPongs, advancePingPongs, outputPass, validateErrors) {
    var matrices = sceneMatrices(canvas.width / Math.max(1, canvas.height));
    var frameTime = currentTime();
    var outputs = {};
    pingPongs = pingPongs || [];
    outputPass = Number.isInteger(outputPass) ? outputPass : state.outputPass;
    pingPongs.forEach(function (pingPong) {
      resizePingPongRuntime(pingPong, canvas.width, canvas.height);
    });
    passes.forEach(function (pass) {
      if (pass.target) resizeTarget(pass.target, canvas.width, canvas.height);
    });
    var geometry = getGeometry();
    passes.forEach(function (pass, index) {
      var writers = pingPongs.filter(function (pingPong) {
        return pingPong.from === index && pingPong.read && pingPong.write;
      });
      var iterations = writers.reduce(function (count, pingPong) {
        return Math.max(count, pingPongIterations(pingPong.iterations));
      }, 1);
      if (advancePingPongs === false) iterations = 1;
      for (var iteration = 0; iteration < iterations; iteration++) {
        writers.forEach(function (pingPong) {
          pingPong.iteration = Math.min(iteration, pingPongIterations(pingPong.iterations) - 1);
        });
        drawPassToFramebuffer(pass, index, pass.target ? pass.target.framebuffer : null, matrices, outputs, connections, pingPongs, frameTime, geometry);
        outputs[index] = pass.target ? pass.target.texture : null;
        var activeWriters = writers.filter(function (pingPong) {
          return iteration < pingPongIterations(pingPong.iterations);
        });
        if (activeWriters.length && !pass.target) {
          throw new Error("通道 " + (index + 1) + " 缺少 Ping-Pong 写入目标。");
        }
        if (validateErrors && activeWriters.length) {
          var passError = gl.getError();
          if (passError !== gl.NO_ERROR) {
            throw new Error("通道 " + (index + 1) + " 写入 Ping-Pong 前渲染失败，WebGL 错误 0x" + passError.toString(16) + "。");
          }
        }
        activeWriters.forEach(function (pingPong) {
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, pass.target.framebuffer);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, pingPong.write.framebuffer);
          gl.blitFramebuffer(0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
          if (validateErrors) {
            var blitError = gl.getError();
            if (blitError !== gl.NO_ERROR) {
              throw new Error("通道 " + (index + 1) + " 写入 " + pingPongLabel(pingPong.id) + " 失败，WebGL 错误 0x" + blitError.toString(16) + "。");
            }
          }
        });
        if (pass.target && index === outputPass && iteration === iterations - 1) {
          drawPassToFramebuffer(pass, index, null, matrices, outputs, connections, pingPongs, frameTime, geometry);
          if (validateErrors) {
            var presentError = gl.getError();
            if (presentError !== gl.NO_ERROR) {
              throw new Error("通道 " + (index + 1) + " 输出到预览画面失败，WebGL 错误 0x" + presentError.toString(16) + "。");
            }
          }
        }
        if (advancePingPongs !== false) {
          activeWriters.forEach(function (pingPong) {
            var previous = pingPong.read;
            pingPong.read = pingPong.write;
            pingPong.write = previous;
            pingPong.phase = pingPong.phase === 0 ? 1 : 0;
          });
        }
      }
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function drawPassToFramebuffer(pass, index, framebuffer, matrices, outputs, connections, pingPongs, frameTime, geometry) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.055, 0.064, 0.075, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(pass.program);
    bindUniforms(pass, index, matrices, outputs, connections, pingPongs, frameTime);
    if (pass.usesModel) drawGeometry(pass.program, geometry, pass.attributeInputs);
    else if (pass.usesCustomPostVertex) drawGeometry(pass.program, getScreenGeometry(), pass.attributeInputs);
    else {
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  var lastRuntimeErrorCheck = 0;
  var previewFrameRequest = null;
  var previewWindowVisible = true;
  var graphInteractionReleaseTimer = null;

  function schedulePreviewFrame() {
    if (!previewWindowVisible || state.graphInteractionActive || previewFrameRequest !== null) return;
    previewFrameRequest = requestAnimationFrame(drawFrame);
  }

  function pausePreviewForGraphInteraction() {
    state.graphInteractionActive = true;
    if (graphInteractionReleaseTimer !== null) {
      clearTimeout(graphInteractionReleaseTimer);
      graphInteractionReleaseTimer = null;
    }
    if (previewFrameRequest !== null) {
      cancelAnimationFrame(previewFrameRequest);
      previewFrameRequest = null;
    }
  }

  function resumePreviewAfterGraphInteraction() {
    if (graphInteractionReleaseTimer !== null) {
      clearTimeout(graphInteractionReleaseTimer);
      graphInteractionReleaseTimer = null;
    }
    state.graphInteractionActive = false;
    schedulePreviewFrame();
  }

  function debouncePreviewAfterGraphZoom() {
    pausePreviewForGraphInteraction();
    graphInteractionReleaseTimer = setTimeout(resumePreviewAfterGraphInteraction, 120);
  }

  function drawFrame(now) {
    previewFrameRequest = null;
    if (!previewWindowVisible || !gl || document.hidden || state.paused || state.graphInteractionActive) return;
    try {
      resizeCanvas();
      if (!state.passes.length) return;
      now = Number(now) || performance.now();
      renderPasses(state.passes, state.activeConnections, state.activePingPongs, true, state.activeOutputPass, false);
      if (now - lastRuntimeErrorCheck >= 1000) {
        lastRuntimeErrorCheck = now;
        var renderError = gl.getError();
        if (renderError !== gl.NO_ERROR) {
          throw new Error("渲染时出现 WebGL 错误 0x" + renderError.toString(16) + "。");
        }
      }
      state.tick++;
      schedulePreviewFrame();
    } catch (error) {
      if (state.runtimeErrorLogged) return;
      state.runtimeErrorLogged = true;
      state.paused = true;
      state.pausedAt = performance.now();
      var pause = document.getElementById("pause");
      pause.textContent = ">";
      pause.classList.add("resume");
      log(error.message + "\n渲染已暂停，当前可用版本仍保留。", "error");
      setStatus("渲染失败", "error");
    }
  }

  window.shaderPreviewSetWindowVisible = function (visible) {
    previewWindowVisible = !!visible;
    if (!previewWindowVisible && previewFrameRequest !== null) {
      cancelAnimationFrame(previewFrameRequest);
      previewFrameRequest = null;
      return;
    }
    schedulePreviewFrame();
  };

  function resizeCanvas() {
    var scale = Math.min(window.devicePixelRatio || 1, 2);
    var width = Math.max(1, Math.floor(canvas.clientWidth * scale));
    var height = Math.max(1, Math.floor(canvas.clientHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      if (state.passes.length) {
        var pendingError = gl.getError();
        if (pendingError !== gl.NO_ERROR) {
          throw new Error("调整预览尺寸前检测到 WebGL 错误 0x" + pendingError.toString(16) + "。");
        }
      }
      canvas.width = width;
      canvas.height = height;
      document.getElementById("viewportStats").textContent = width + " x " + height;
    }
  }

  var geometryCache = {};
  function getGeometry() {
    var key = state.geometry === "obj" && state.obj ? "obj:" + state.obj.path : state.geometry;
    if (geometryCache[key]) return geometryCache[key];
    var mesh;
    if (state.geometry === "cube") mesh = cubeMesh();
    else if (state.geometry === "plane") mesh = planeMesh();
    else if (state.geometry === "obj" && state.obj) mesh = state.obj.mesh || parseObj(state.obj.source);
    else mesh = sphereMesh(32, 20);
    geometryCache[key] = uploadMesh(mesh);
    return geometryCache[key];
  }

  function getScreenGeometry() {
    if (!geometryCache.screen) {
      geometryCache.screen = uploadMesh({
        positions: [-1, -1, 0, 3, -1, 0, -1, 3, 0],
        normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
        uvs: [0, 0, 2, 0, 0, 2],
        indices: [0, 1, 2]
      });
    }
    return geometryCache.screen;
  }

  function uploadMesh(mesh) {
    gl.bindVertexArray(null);
    function buffer(data) {
      var buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      return buffer;
    }
    var indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.indices), gl.STATIC_DRAW);
    return {
      position: buffer(mesh.positions),
      normal: buffer(mesh.normals),
      uv: buffer(mesh.uvs),
      index: indexBuffer,
      count: mesh.indices.length,
      vaos: new Map()
    };
  }

  function disposeGeometry(geometry) {
    if (!geometry || !gl) return;
    geometry.vaos.forEach(function (vao) { gl.deleteVertexArray(vao); });
    gl.deleteBuffer(geometry.position);
    gl.deleteBuffer(geometry.normal);
    gl.deleteBuffer(geometry.uv);
    gl.deleteBuffer(geometry.index);
  }

  function drawGeometry(program, geometry, attributeInputs) {
    var vao = geometry.vaos.get(program);
    if (!vao) {
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.index);
      var count = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
      for (var index = 0; index < count; index++) {
        var active = gl.getActiveAttrib(program, index);
        if (!active) continue;
        var location = gl.getAttribLocation(program, active.name);
        if (location < 0) continue;
        var semantic = attributeSemantic(active.name, attributeInputs, uniformTypeName(active.type));
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry[semantic]);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, semantic === "uv" ? 2 : 3, gl.FLOAT, false, 0, 0);
      }
      geometry.vaos.set(program, vao);
    }
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, geometry.count, gl.UNSIGNED_INT, 0);
  }

  function attributeSemantic(name, attributeInputs, type) {
    var setting = attributeInputs && attributeInputs[name];
    return setting ? setting.semantic : inferredAttributeSemantic(name, type);
  }

  function invalidateGeometryVaos() {
    Object.keys(geometryCache).forEach(function (key) {
      var geometry = geometryCache[key];
      geometry.vaos.forEach(function (vao) { gl.deleteVertexArray(vao); });
      geometry.vaos.clear();
    });
  }

  function sphereMesh(segments, rings) {
    return meshFromThreeGeometry(new THREE.SphereGeometry(1, segments, rings));
  }

  function cubeMesh() {
    return meshFromThreeGeometry(new THREE.BoxGeometry(2, 2, 2));
  }

  function planeMesh() {
    var geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    return meshFromThreeGeometry(geometry);
  }

  function meshFromThreeGeometry(geometry) {
    var positions = Array.from(geometry.attributes.position.array);
    var normals = geometry.attributes.normal ? Array.from(geometry.attributes.normal.array) : new Array(positions.length).fill(0);
    var uvs = geometry.attributes.uv ? Array.from(geometry.attributes.uv.array) : new Array(positions.length / 3 * 2).fill(0);
    var indices = geometry.index ? Array.from(geometry.index.array) : positions.reduce(function (result, _, index) {
      if (index % 3 === 0) result.push(index / 3);
      return result;
    }, []);
    geometry.dispose();
    return { positions: positions, normals: normals, uvs: uvs, indices: indices };
  }

  function parseObj(source) {
    var sourcePositions = [], sourceNormals = [], sourceUvs = [];
    var faces = [];
    var positions = [], normals = [], uvs = [], indices = [];
    String(source).split(/\r?\n/).forEach(function (line) {
      var parts = line.trim().split(/\s+/), kind = parts.shift();
      if (kind === "v") sourcePositions.push(parts.slice(0,3).map(Number));
      else if (kind === "vn") sourceNormals.push(parts.slice(0,3).map(Number));
      else if (kind === "vt") sourceUvs.push(parts.slice(0,2).map(Number));
      else if (kind === "f" && parts.length >= 3) faces.push(parts);
    });
    var bounds = objBounds(sourcePositions);
    faces.forEach(function (face) {
      for (var triangle = 1; triangle < face.length - 1; triangle++) {
        var refs = [face[0], face[triangle], face[triangle + 1]].map(function (token) {
          return token.split("/").map(Number);
        });
        var trianglePositions = refs.map(function (ref) {
          return resolveObj(sourcePositions, ref[0]) || [0, 0, 0];
        });
        var edgeA = subtract3(trianglePositions[1], trianglePositions[0]);
        var edgeB = subtract3(trianglePositions[2], trianglePositions[0]);
        var faceNormal = normalize3(cross3(edgeA, edgeB));
        refs.forEach(function (ref, vertexIndex) {
          var position = trianglePositions[vertexIndex];
          var normal = resolveObj(sourceNormals, ref[2]) || faceNormal;
          var sourceUv = resolveObj(sourceUvs, ref[1]);
          var uv = sourceUv ? [sourceUv[0], 1 - sourceUv[1]] : generatedObjUv(position, normal, bounds);
          positions.push.apply(positions, position);
          normals.push.apply(normals, normal);
          uvs.push.apply(uvs, uv);
          indices.push(indices.length);
        });
      }
    });
    if (!indices.length) throw new Error("OBJ 中没有可用的三角面。");
    normalizePositions(positions);
    return { positions: positions, normals: normals, uvs: uvs, indices: indices };
  }

  function objBounds(positions) {
    var min = [Infinity, Infinity, Infinity];
    var max = [-Infinity, -Infinity, -Infinity];
    positions.forEach(function (position) {
      for (var component = 0; component < 3; component++) {
        min[component] = Math.min(min[component], position[component]);
        max[component] = Math.max(max[component], position[component]);
      }
    });
    return { min: min, max: max };
  }

  function generatedObjUv(position, normal, bounds) {
    function axisValue(axis) {
      var range = bounds.max[axis] - bounds.min[axis];
      return range > 0.000001 ? (position[axis] - bounds.min[axis]) / range : 0.5;
    }
    var absolute = normal.map(Math.abs);
    var axes = absolute[0] >= absolute[1] && absolute[0] >= absolute[2] ? [2, 1] :
      absolute[1] >= absolute[2] ? [0, 2] : [0, 1];
    return [axisValue(axes[0]), 1 - axisValue(axes[1])];
  }

  function resolveObj(list, index) {
    if (!index) return null;
    return list[index > 0 ? index - 1 : list.length + index];
  }

  function normalizePositions(positions) {
    var min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
    for (var i = 0; i < positions.length; i += 3) for (var c = 0; c < 3; c++) { min[c] = Math.min(min[c], positions[i+c]); max[c] = Math.max(max[c], positions[i+c]); }
    var center = min.map(function (v,c) { return (v + max[c]) * .5; }), scale = 2 / Math.max(max[0]-min[0], max[1]-min[1], max[2]-min[2], .0001);
    for (var j = 0; j < positions.length; j++) positions[j] = (positions[j] - center[j % 3]) * scale;
  }

  function normalize3(value) {
    var length = Math.hypot(value[0], value[1], value[2]) || 1;
    return [value[0]/length, value[1]/length, value[2]/length];
  }

  function subtract3(left, right) {
    return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
  }

  function cross3(left, right) {
    return [
      left[1] * right[2] - left[2] * right[1],
      left[2] * right[0] - left[0] * right[2],
      left[0] * right[1] - left[1] * right[0]
    ];
  }

  function sceneMatrices(aspect) {
    var distance = Number(document.getElementById("cameraDistance").value);
    sceneEye.set(Math.cos(state.pitch)*Math.sin(state.yaw)*distance, Math.sin(state.pitch)*distance, Math.cos(state.pitch)*Math.cos(state.yaw)*distance);
    sceneCamera.fov = Number(document.getElementById("cameraFov").value);
    sceneCamera.aspect = aspect;
    sceneCamera.position.copy(sceneEye);
    sceneCamera.lookAt(0, 0, 0);
    sceneCamera.updateMatrixWorld(true);
    sceneCamera.updateProjectionMatrix();
    sceneMatrixValues.view.set(sceneCamera.matrixWorldInverse.elements);
    sceneMatrixValues.projection.set(sceneCamera.projectionMatrix.elements);
    sceneMatrixValues.eye[0] = sceneEye.x;
    sceneMatrixValues.eye[1] = sceneEye.y;
    sceneMatrixValues.eye[2] = sceneEye.z;
    return sceneMatrixValues;
  }

  var graphRuntimes = {
    model: createGraphRuntime(),
    post: createGraphRuntime()
  };
  var graphInputSelector = "[data-input], [data-model-input], [data-ping-pong-input], [data-final-output]";

  function createGraphRuntime() {
    return {
      activeInteraction: null,
      renderPending: false,
      suppressRenderFlush: false,
      viewportFrame: null,
      backgroundTimer: null
    };
  }

  function graphRuntime(chain) {
    return graphRuntimes[chain === "post" ? "post" : "model"];
  }

  function graphCanvasFor(chain) {
    return document.getElementById(chain === "post" ? "postGraphCanvas" : "modelGraphCanvas");
  }

  function cancelActiveGraphInteraction(chain) {
    var runtime = graphRuntime(chain);
    var cleanup = runtime.activeInteraction;
    runtime.activeInteraction = null;
    if (!cleanup) return;
    runtime.suppressRenderFlush = true;
    cleanup();
    runtime.suppressRenderFlush = false;
  }

  function flushPendingGraphRender(chain) {
    var runtime = graphRuntime(chain);
    if (runtime.suppressRenderFlush || runtime.activeInteraction || !runtime.renderPending) return;
    runtime.renderPending = false;
    renderGraph(chain);
  }

  function renderGraph(chain) {
    if (chain === "model" || chain === "post") {
      renderGraphChain(chain);
      return;
    }
    renderGraphChain("model");
    renderGraphChain("post");
  }

  function renderGraphChain(chain) {
    var runtime = graphRuntime(chain);
    if (runtime.activeInteraction) {
      runtime.renderPending = true;
      return;
    }
    runtime.renderPending = false;
    var graph = graphState(chain);
    var host = graphCanvasFor(chain);
    host.textContent = "";
    var scene = document.createElement("div");
    scene.className = "graph-scene";
    scene.dataset.graphChain = chain;
    host.appendChild(scene);
    updateGraphViewport(chain, true);
    reconcileConnections();
    var files = state.fragments.map(function (file, index) { return { file: file, index: index }; }).filter(function (entry) {
      return chainForPass(entry.index) === chain;
    });
    var columnWidth = 340;
    var inputLeft = 25;
    var passStart = inputLeft + columnWidth;
    var mainTop = 55;
    var lane = document.createElement("div");
    lane.className = "graph-lane-label " + (chain === "model" ? "model-lane-label" : "post-lane-label");
    lane.style.left = inputLeft + "px";
    lane.style.top = "14px";
    lane.textContent = chain === "model" ? "模型渲染链" : "后处理链";
    scene.appendChild(lane);

    if (chain === "model" && state.modelPass >= 0) {
      var inputNode = document.createElement("div");
      inputNode.className = "graph-node graph-terminal input-terminal";
      inputNode.dataset.nodeId = "input";
      inputNode.dataset.graphChain = chain;
      var storedInput = graphPosition(chain, "input", inputLeft, mainTop);
      inputNode.style.left = storedInput.left + "px";
      inputNode.style.top = storedInput.top + "px";
      inputNode.innerHTML = '<header>模型输入</header>' +
        '<div class="port output graph-model-output" data-graph-output="model" data-source-kind="model" data-source-id="model"><span>模型 / 顶点</span><small>' + escapeHtml(state.vertex ? state.vertex.name : "内置顶点") + '</small></div>';
      scene.appendChild(inputNode);
      makeGraphNodeDraggable(inputNode, "input", scene, chain);
    } else if (chain === "post") {
      var bridge = document.createElement("div");
      bridge.className = "graph-node graph-terminal input-terminal";
      bridge.dataset.nodeId = "model-source";
      bridge.dataset.graphChain = chain;
      var storedBridge = graphPosition(chain, "model-source", inputLeft, mainTop);
      bridge.style.left = storedBridge.left + "px";
      bridge.style.top = storedBridge.top + "px";
      var modelOutput = state.modelPass >= 0 ? passOutput(state.modelPass) : { supported: false, reason: "未创建模型渲染" };
      bridge.innerHTML = '<header>模型输出</header>' +
        '<div class="port output pass-output' + (modelOutput.supported ? '' : ' unsupported') + '"' +
        (state.modelPass >= 0 ? ' data-source-kind="pass" data-source-id="' + state.modelPass + '"' : '') +
        '><span>模型颜色</span><small>' + escapeHtml(modelOutput.supported ? "RGBA8" : modelOutput.reason) + '</small></div>';
      scene.appendChild(bridge);
      makeGraphNodeDraggable(bridge, "model-source", scene, chain);
    }

    state.textureNodes.filter(function (textureNode) { return textureNode.chain === chain; }).forEach(function (textureNode, index) {
      var texture = textureById(textureNode.texture);
      var nodeId = textureNodeId(textureNode.id);
      var node = document.createElement("div");
      node.className = "graph-node graph-texture-node";
      node.dataset.nodeId = nodeId;
      node.dataset.graphChain = chain;
      node.dataset.dropStage = "texture";
      node.dataset.dropTextureNode = textureNode.id;
      var storedTexture = graphPosition(chain, nodeId, inputLeft, mainTop + 340 + index * 145);
      node.style.left = storedTexture.left + "px";
      node.style.top = storedTexture.top + "px";
      var preview = texture ?
        '<div class="graph-texture-preview"><img alt="" src="' + escapeHtml(texture.dataUrl) + '"><span><strong>' + escapeHtml(texture.name) + '</strong><small>' + texture.width + ' × ' + texture.height + '</small></span></div>' :
        '<div class="graph-texture-preview empty"><span class="graph-texture-placeholder" aria-hidden="true"></span><span><strong>未绑定纹理</strong><small>sampler2D</small></span></div>';
      var output = texture ?
        '<div class="port output graph-texture-output" data-texture-node="' + escapeHtml(textureNode.id) + '" data-source-kind="texture" data-source-id="' + escapeHtml(textureNode.id) + '"><span>颜色</span><small>sampler2D</small></div>' :
        '<div class="port output graph-texture-output unsupported"><span>颜色</span><small>未绑定</small></div>';
      node.innerHTML = '<header><span>纹理</span><span class="graph-node-actions"><button class="graph-node-browse" type="button" title="选择纹理图片" aria-label="选择纹理图片">...</button>' +
        '<button class="graph-node-delete" type="button" title="删除纹理节点" aria-label="删除纹理节点">×</button></span></header>' + preview + output;
      node.querySelector(".graph-node-browse").addEventListener("click", function () { chooseTexture(null, chain, textureNode.id); });
      node.querySelector(".graph-node-delete").addEventListener("click", function () { removeTextureNode(textureNode.id); });
      scene.appendChild(node);
      makeGraphNodeDraggable(node, nodeId, scene, chain);
    });

    state.pingPongs.filter(function (pingPong) { return pingPong.chain === chain; }).forEach(function (pingPong, index) {
      var nodeId = pingPongNodeId(pingPong.id);
      var node = document.createElement("div");
      node.className = "graph-node graph-pingpong-node";
      node.dataset.nodeId = nodeId;
      node.dataset.graphChain = chain;
      var defaultLeft = Number.isInteger(pingPong.from) ? passStart + pingPong.from * columnWidth : passStart;
      var storedPingPong = graphPosition(chain, nodeId, defaultLeft, mainTop + 340 + index * 205);
      node.style.left = storedPingPong.left + "px";
      node.style.top = storedPingPong.top + "px";
      var inputLabel = Number.isInteger(pingPong.from) ? "通道 " + (pingPong.from + 1) : "未连接";
      node.innerHTML = '<header><span>' + escapeHtml(pingPongLabel(pingPong.id)) + '</span><button class="graph-node-delete" type="button" title="删除 Ping-Pong" aria-label="删除 Ping-Pong">×</button></header>' +
        '<button class="port input graph-pingpong-input" data-ping-pong-input="' + escapeHtml(pingPong.id) + '" type="button"><span>当前帧写入</span><small>' + escapeHtml(inputLabel) + '</small></button>' +
        '<div class="graph-pingpong-settings">' +
          '<label><span>每帧写入</span><input class="graph-pingpong-iterations" type="number" min="1" max="64" step="1" value="' + pingPongIterations(pingPong.iterations) + '"></label>' +
          '<label><span>迭代变量</span><input class="graph-pingpong-iteration-alias" type="text" value="' + escapeHtml(pingPong.iterationAlias || "iteration, iIteration") + '" placeholder="iteration, iIteration"></label>' +
          '<label><span>相位变量</span><input class="graph-pingpong-phase-alias" type="text" value="' + escapeHtml(pingPong.phaseAlias || "phase, iPhase") + '" placeholder="phase, iPhase" title="写入 Ping 时为 0，写入 Pong 时为 1"></label>' +
        '</div>' +
        '<div class="port output graph-pingpong-output" data-source-kind="pingpong" data-source-id="' + escapeHtml(pingPong.id) + '"><span>上一帧输出</span><small>sampler2D</small></div>';
      node.querySelector(".graph-node-delete").addEventListener("click", function () { removePingPong(pingPong.id); });
      node.querySelector(".graph-pingpong-input").addEventListener("click", function () { cyclePingPongInput(pingPong.id); });
      node.querySelector(".graph-pingpong-iterations").addEventListener("input", function (event) {
        updatePingPongSetting(pingPong.id, "iterations", event.target.value);
      });
      node.querySelector(".graph-pingpong-iterations").addEventListener("change", function (event) {
        event.target.value = String(pingPongIterations(event.target.value));
      });
      node.querySelector(".graph-pingpong-iteration-alias").addEventListener("change", function (event) {
        updatePingPongSetting(pingPong.id, "iterationAlias", event.target.value);
      });
      node.querySelector(".graph-pingpong-phase-alias").addEventListener("change", function (event) {
        updatePingPongSetting(pingPong.id, "phaseAlias", event.target.value);
      });
      scene.appendChild(node);
      makeGraphNodeDraggable(node, nodeId, scene, chain);
    });

    files.forEach(function (entry, graphIndex) {
      var index = entry.index;
      var isModel = chain === "model";
      var node = document.createElement("div");
      node.className = "graph-node graph-shader-node " + (isModel ? "graph-model-pass" : "graph-post-pass");
      node.dataset.nodeId = "pass:" + index;
      node.dataset.graphChain = chain;
      node.dataset.dropStage = "fragment";
      node.dataset.dropIndex = String(index);
      var defaultLeft = passStart + graphIndex * columnWidth;
      var storedPass = graphPosition(chain, "pass:" + index, defaultLeft, mainTop);
      var left = storedPass.left;
      var top = storedPass.top;
      node.style.left = left + "px";
      node.style.top = top + "px";
      var inputs = samplerInputs(index);
      var output = passOutput(index);
      var body = '<header><span>' + (isModel ? '模型渲染' : '后处理 ' + (graphIndex + 1)) + '</span>' +
        '<span class="graph-node-actions"><button class="graph-node-browse" type="button" title="选择片元着色器" aria-label="选择片元着色器">...</button>' +
        '<button class="graph-node-delete" type="button" title="删除着色器节点" aria-label="删除着色器节点">×</button></span></header>';
      body += '<div class="graph-shader-file"><span class="stage-badge fragment">F</span><span><strong>片元着色器</strong><small>' + escapeHtml(entry.file ? entry.file.name : "未绑定") + '</small></span></div>';
      if (isModel) body += '<button class="port input graph-model-input" data-model-input="true" data-target-pass="' + index + '" type="button"><span>模型 / 顶点</span><small>已连接</small></button>';
      inputs.forEach(function (input) {
        var connection = connectionSetting(index, input.name);
        var textureNode = connection && connection.textureNode ? textureNodeById(connection.textureNode) : null;
        var texture = textureNode ? textureById(textureNode.texture) : null;
        var pingPong = connection && connection.pingPong ? pingPongById(connection.pingPong) : null;
        var sourceLabel = texture ? texture.name : pingPong ? pingPongLabel(pingPong.id) : connection && connection.from >= 0 ? "通道 " + (connection.from + 1) : "默认黑色";
        var disabled = !input.supported;
        body += '<button class="port input" data-input="' + escapeHtml(input.name) + '" data-target-pass="' + index + '" type="button"' + (disabled ? ' disabled' : '') + '><span>' + escapeHtml(input.name) + '</span><small>' + escapeHtml(sourceLabel) + '</small></button>';
      });
      body += '<div class="port output pass-output' + (output.supported ? '' : ' unsupported') + '" data-source-kind="pass" data-source-id="' + index + '"><span>' + escapeHtml(output.name) + '</span><small>' + escapeHtml(output.supported ? 'RGBA8' : output.reason) + '</small></div>';
      node.innerHTML = body;
      node.querySelector(".graph-node-browse").addEventListener("click", function () { chooseShader("fragment", index); });
      node.querySelector(".graph-node-delete").addEventListener("click", function () { removeFragmentPass(index); });
      node.querySelectorAll(".input").forEach(function (inputNode) {
        if (!inputNode.dataset.input) return;
        inputNode.title = "选择此采样器的纹理、Ping-Pong 或上游通道";
        inputNode.addEventListener("click", function () { cycleConnection(index, inputNode.dataset.input); });
      });
      appendFragmentParameters(node, index);
      scene.appendChild(node);
      makeGraphNodeDraggable(node, "pass:" + index, scene, chain);
    });

    var outputLeft = passStart + Math.max(1, files.length) * columnWidth;
    var outputNode = document.createElement("div");
    outputNode.className = "graph-node graph-terminal output-terminal";
    outputNode.dataset.nodeId = chain === "model" ? "model-output" : "output";
    outputNode.dataset.graphChain = chain;
    var storedOutput = graphPosition(chain, outputNode.dataset.nodeId, outputLeft, mainTop);
    outputNode.style.left = storedOutput.left + "px";
    outputNode.style.top = storedOutput.top + "px";
    if (chain === "model") {
      outputNode.innerHTML = '<header>模型输出</header><div class="port input graph-model-result-input"><span>颜色纹理</span><small>' + (state.modelPass >= 0 ? '模型渲染' : '未连接') + '</small></div>';
    } else {
      var outputLabel = state.outputPass === state.modelPass && state.modelPass >= 0 ? "模型输出" :
        state.outputPass >= 0 ? "通道 " + (state.outputPass + 1) : "未连接";
      outputNode.innerHTML = '<header>输出</header><div class="port input graph-final-input" data-final-output="true"><span>预览画面</span><small>' + outputLabel + '</small></div>';
    }
    scene.appendChild(outputNode);
    makeGraphNodeDraggable(outputNode, outputNode.dataset.nodeId, scene, chain);
    refreshGraphLinks(scene, chain);
    installGraphWiring(host, scene, chain);
    if (graph.needsFit && host.classList.contains("active") && document.getElementById("graphView").classList.contains("active")) {
      requestAnimationFrame(function () { fitGraphToView(chain); });
    }
  }

  function graphPosition(chain, id, left, top) {
    return graphState(chain).positions[id] || { left: left, top: top };
  }

  function makeGraphNodeDraggable(node, id, scene, chain) {
    var graph = graphState(chain);
    var runtime = graphRuntime(chain);
    var header = node.querySelector("header");
    header.title = "拖动节点";
    node.querySelectorAll(".port.file, .stage-input, .graph-texture-preview").forEach(function (surface) {
      surface.title = "拖动节点";
    });
    node.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) return;
      var interactive = event.target.closest ? event.target.closest("button, input, select, textarea, label, a, [data-source-kind], " + graphInputSelector) : null;
      if (interactive) return;
      cancelActiveGraphInteraction(chain);
      event.preventDefault();
      event.stopPropagation();
      var startX = event.clientX;
      var startY = event.clientY;
      var startLeft = parseFloat(node.style.left) || 0;
      var startTop = parseFloat(node.style.top) || 0;
      var pointerId = event.pointerId;
      var moveFrame = null;
      var pendingPosition = null;
      node.classList.add("dragging-node");
      graph.needsFit = false;
      function applyMove() {
        moveFrame = null;
        if (!pendingPosition || !scene.isConnected) return;
        node.style.left = pendingPosition.left + "px";
        node.style.top = pendingPosition.top + "px";
        graph.positions[id] = pendingPosition;
        pendingPosition = null;
        refreshGraphLinks(scene, chain);
      }
      function move(moveEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        var left = startLeft + (moveEvent.clientX - startX) / graph.viewport.zoom;
        var top = startTop + (moveEvent.clientY - startY) / graph.viewport.zoom;
        pendingPosition = { left: left, top: top };
        if (moveFrame === null) moveFrame = requestAnimationFrame(applyMove);
      }
      function finish(finishEvent) {
        if (finishEvent && finishEvent.pointerId !== undefined && finishEvent.pointerId !== pointerId) return;
        if (moveFrame !== null) cancelAnimationFrame(moveFrame);
        if (pendingPosition) applyMove();
        if (runtime.activeInteraction === finish) runtime.activeInteraction = null;
        node.classList.remove("dragging-node");
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", finish);
        document.removeEventListener("pointercancel", finish);
        window.removeEventListener("blur", finish);
        resumePreviewAfterGraphInteraction();
        flushPendingGraphRender(chain);
      }
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", finish);
      document.addEventListener("pointercancel", finish);
      window.addEventListener("blur", finish);
      runtime.activeInteraction = finish;
      pausePreviewForGraphInteraction();
    });
  }

  function refreshGraphLinks(scene, chain) {
    var links = new Map();
    scene.querySelectorAll(".graph-link[data-graph-link-key]").forEach(function (link) {
      links.set(link.dataset.graphLinkKey, link);
    });
    var activeKeys = new Set();
    function updateLink(key, from, to, kind) {
      activeKeys.add(key);
      var link = links.get(key);
      if (!link) {
        link = document.createElement("div");
        link.className = "graph-link " + kind;
        link.dataset.graphLinkKey = key;
        scene.insertBefore(link, scene.firstChild);
      } else if (link.className !== "graph-link " + kind) {
        link.className = "graph-link " + kind;
      }
      var length = Math.hypot(to.x - from.x, to.y - from.y);
      var angle = Math.atan2(to.y - from.y, to.x - from.x);
      link.style.left = from.x + "px";
      link.style.top = from.y + "px";
      link.style.width = length + "px";
      link.style.transform = "rotate(" + angle + "rad)";
    }
    var inputNode = chain === "model" ? scene.querySelector('[data-node-id="input"]') : null;
    var modelPass = chain === "model" ? scene.querySelector('[data-node-id="pass:' + state.modelPass + '"]') : null;
    if (inputNode && modelPass) {
      updateLink(
        "model-input",
        graphPortPoint(inputNode.querySelector(".graph-model-output"), true),
        graphPortPoint(modelPass.querySelector(".graph-model-input"), false),
        "model-link"
      );
    }
    state.connections.forEach(function (connection) {
      if (chainForPass(connection.to) !== chain) return;
      var sourceNode = connection.textureNode
        ? scene.querySelector('[data-node-id="' + cssEscape(textureNodeId(connection.textureNode)) + '"]')
        : connection.pingPong
          ? scene.querySelector('[data-node-id="' + cssEscape(pingPongNodeId(connection.pingPong)) + '"]')
          : chain === "post" && connection.from === state.modelPass
            ? scene.querySelector('[data-node-id="model-source"]')
            : scene.querySelector('[data-node-id="pass:' + connection.from + '"]');
      var targetNode = scene.querySelector('[data-node-id="pass:' + connection.to + '"]');
      if (!sourceNode || !targetNode) return;
      var sourcePort = connection.textureNode
        ? sourceNode.querySelector(".graph-texture-output")
        : connection.pingPong
          ? sourceNode.querySelector(".graph-pingpong-output")
          : sourceNode.querySelector(".pass-output");
      var targetPort = targetNode.querySelector('[data-input="' + cssEscape(connection.input) + '"]');
      if (!sourcePort || !targetPort) return;
      updateLink(
        "connection:" + state.connections.indexOf(connection),
        graphPortPoint(sourcePort, true),
        graphPortPoint(targetPort, false),
        connection.textureNode ? "texture-link" : connection.pingPong ? "pingpong-link" : "pass-link"
      );
    });
    state.pingPongs.filter(function (pingPong) { return pingPong.chain === chain; }).forEach(function (pingPong) {
      if (!Number.isInteger(pingPong.from)) return;
      var sourceNode = chain === "post" && pingPong.from === state.modelPass
        ? scene.querySelector('[data-node-id="model-source"]')
        : scene.querySelector('[data-node-id="pass:' + pingPong.from + '"]');
      var targetNode = scene.querySelector('[data-node-id="' + cssEscape(pingPongNodeId(pingPong.id)) + '"]');
      if (!sourceNode || !targetNode) return;
      var sourcePort = sourceNode.querySelector(".pass-output");
      var targetPort = targetNode.querySelector(".graph-pingpong-input");
      if (!sourcePort || !targetPort) return;
      updateLink(
        "pingpong-write:" + pingPong.id,
        graphPortPoint(sourcePort, true),
        graphPortPoint(targetPort, false),
        "pingpong-write-link"
      );
    });
    if (chain === "model") {
      var modelOutputNode = scene.querySelector('[data-node-id="model-output"]');
      if (modelOutputNode && modelPass) {
        updateLink(
          "model-output",
          graphPortPoint(modelPass.querySelector(".pass-output"), true),
          graphPortPoint(modelOutputNode.querySelector(".graph-model-result-input"), false),
          "model-link"
        );
      }
    } else {
      var outputNode = scene.querySelector('[data-node-id="output"]');
      var outputPass = state.modelPass >= 0 && state.outputPass === state.modelPass
        ? scene.querySelector('[data-node-id="model-source"]')
        : scene.querySelector('[data-node-id="pass:' + state.outputPass + '"]');
      if (outputNode && outputPass) {
        updateLink(
          "graph-output",
          graphPortPoint(outputPass.querySelector(".pass-output"), true),
          graphPortPoint(outputNode.querySelector(".graph-final-input"), false),
          "output-link"
        );
      }
    }
    links.forEach(function (link, key) {
      if (!activeKeys.has(key)) link.remove();
    });
  }

  function installGraphWiring(host, scene, chain) {
    scene.querySelectorAll("[data-source-kind]").forEach(function (sourcePort) {
      sourcePort.title = "拖动连接线";
      sourcePort.addEventListener("pointerdown", function (event) {
        beginGraphWiring(host, scene, sourcePort, true, event, chain);
      });
    });
    scene.querySelectorAll(graphInputSelector).forEach(function (inputPort) {
      if (inputPort.disabled) return;
      inputPort.title = inputPort.dataset.input ? "拖动连接线，或点击切换输入" : "拖动连接线";
      inputPort.addEventListener("pointerdown", function (event) {
        beginGraphWiring(host, scene, inputPort, false, event, chain);
      });
    });
  }

  function beginGraphWiring(host, scene, startPort, startsAtOutput, event, chain) {
    if (event.button !== 0 || startPort.classList.contains("unsupported") || startPort.disabled) return;
    var runtime = graphRuntime(chain);
    cancelActiveGraphInteraction(chain);
    event.preventDefault();
    event.stopPropagation();
    var pointerId = event.pointerId;
    var fixedPoint = graphPortPoint(startPort, startsAtOutput);
    startPort.classList.add("wiring");
    function move(moveEvent) {
      if (moveEvent.pointerId !== pointerId || !scene.isConnected) return;
      var oldPreview = scene.querySelector(".wire-preview");
      if (oldPreview) oldPreview.remove();
      var pointerPoint = graphCanvasPoint(host, moveEvent);
      drawGraphLink(scene, startsAtOutput ? fixedPoint : pointerPoint, startsAtOutput ? pointerPoint : fixedPoint, "wire-preview");
    }
    function finish(finishEvent) {
      if (finishEvent.pointerId !== pointerId) return;
      var target = document.elementFromPoint(finishEvent.clientX, finishEvent.clientY);
      var sourcePort = startsAtOutput ? startPort : closestGraphPort(target, "[data-source-kind]", scene);
      var inputPort = startsAtOutput ? closestGraphPort(target, graphInputSelector, scene) : startPort;
      cleanup();
        if (sourcePort && inputPort) connectGraphPorts(sourcePort, inputPort);
    }
    function cleanup() {
      if (runtime.activeInteraction === cleanup) runtime.activeInteraction = null;
      var preview = scene.querySelector(".wire-preview");
      if (preview) preview.remove();
      startPort.classList.remove("wiring");
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cleanup);
      resumePreviewAfterGraphInteraction();
      flushPendingGraphRender(chain);
    }
    function cancel(cancelEvent) {
      if (!cancelEvent || cancelEvent.pointerId === pointerId) cleanup();
    }
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cleanup);
    runtime.activeInteraction = cleanup;
    pausePreviewForGraphInteraction();
  }

  function closestGraphPort(target, selector, scene) {
    var port = target && target.closest ? target.closest(selector) : null;
    return port && scene.contains(port) ? port : null;
  }

  function connectGraphPorts(sourcePort, inputPort) {
    var sourceNode = sourcePort.closest(".graph-node");
    var inputNode = inputPort.closest(".graph-node");
    if (!sourceNode || !inputNode || sourceNode.dataset.graphChain !== inputNode.dataset.graphChain) {
      log("不能跨节点图窗口连接端口。", "error");
      return;
    }
    if (sourcePort.classList.contains("unsupported")) {
      log("该通道输出暂不支持连接。", "error");
      return;
    }
    var sourceKind = sourcePort.dataset.sourceKind;
    var source = sourceKind === "texture"
      ? { textureNode: sourcePort.dataset.sourceId }
      : sourceKind === "pingpong"
        ? { pingPong: sourcePort.dataset.sourceId }
        : { from: Number(sourcePort.dataset.sourceId) };
    if (inputPort.dataset.modelInput && sourceKind === "model") {
      setModelPass(Number(inputPort.dataset.targetPass));
      return;
    }
    if (inputPort.dataset.pingPongInput) {
      if (sourceKind === "pass" && Number.isInteger(source.from)) {
        setPingPongInput(inputPort.dataset.pingPongInput, source.from);
      } else {
        log("Ping-Pong 的写入端只能连接片元通道输出。", "error");
      }
      return;
    }
    if (inputPort.disabled) {
      log("该采样器类型暂不支持纹理连接。", "error");
      return;
    }
    if (inputPort.dataset.input !== undefined && sourceKind !== "model") {
      var targetPass = Number(inputPort.dataset.targetPass);
      if (sourceKind === "pass" && Number.isInteger(source.from) && source.from >= targetPass) {
        log("通道输出只能连接到更晚通道的采样器。", "error");
      } else {
        setConnection(targetPass, inputPort.dataset.input, source);
      }
      return;
    }
    if (inputPort.dataset.finalOutput && sourceKind === "pass" && Number.isInteger(source.from)) {
      state.outputPass = source.from;
      state.compileRevision++;
      renderGraph();
      graphModified();
    }
  }

  function graphCanvasPoint(host, event) {
    var bounds = host.getBoundingClientRect();
    var viewport = graphState(host.dataset.graphChain).viewport;
    return {
      x: (event.clientX - bounds.left - viewport.x) / viewport.zoom,
      y: (event.clientY - bounds.top - viewport.y) / viewport.zoom
    };
  }

  function graphViewportCenterPosition(chain) {
    var host = graphCanvasFor(chain);
    var bounds = host.getBoundingClientRect();
    var viewport = graphState(chain).viewport;
    return {
      left: (bounds.width / 2 - viewport.x) / viewport.zoom - 155,
      top: (bounds.height / 2 - viewport.y) / viewport.zoom - 70
    };
  }

  function graphPortPoint(port, output) {
    var node = port.closest(".graph-node");
    return {
      x: node.offsetLeft + port.offsetLeft + (output ? port.offsetWidth : 0),
      y: node.offsetTop + port.offsetTop + port.offsetHeight / 2
    };
  }

  function drawGraphLink(scene, from, to, kind) {
    var link = document.createElement("div");
    var length = Math.hypot(to.x - from.x, to.y - from.y);
    var angle = Math.atan2(to.y - from.y, to.x - from.x);
    link.className = "graph-link " + kind;
    link.style.left = from.x + "px";
    link.style.top = from.y + "px";
    link.style.width = length + "px";
    link.style.transform = "rotate(" + angle + "rad)";
    scene.insertBefore(link, scene.firstChild);
  }

  function applyGraphViewport(chain) {
    var host = graphCanvasFor(chain);
    var scene = host.querySelector(".graph-scene");
    var viewport = graphState(chain).viewport;
    if (scene) scene.style.transform = "translate(" + viewport.x + "px," + viewport.y + "px) scale(" + viewport.zoom + ")";
    if (state.activeGraph === chain) document.getElementById("resetZoom").textContent = Math.round(viewport.zoom * 100) + "%";
  }

  function applyGraphBackground(chain) {
    var host = graphCanvasFor(chain);
    var viewport = graphState(chain).viewport;
    host.style.backgroundPosition = viewport.x + "px " + viewport.y + "px";
    host.style.backgroundSize = 18 * viewport.zoom + "px " + 18 * viewport.zoom + "px";
  }

  function updateGraphViewport(chain, immediate) {
    var runtime = graphRuntime(chain);
    if (immediate) {
      if (runtime.viewportFrame !== null) cancelAnimationFrame(runtime.viewportFrame);
      runtime.viewportFrame = null;
      applyGraphViewport(chain);
      applyGraphBackground(chain);
      return;
    }
    if (runtime.viewportFrame === null) {
      runtime.viewportFrame = requestAnimationFrame(function () {
        runtime.viewportFrame = null;
        applyGraphViewport(chain);
      });
    }
    if (runtime.backgroundTimer !== null) clearTimeout(runtime.backgroundTimer);
    runtime.backgroundTimer = setTimeout(function () {
      runtime.backgroundTimer = null;
      applyGraphBackground(chain);
    }, 90);
  }

  function setGraphZoom(chain, zoom, clientX, clientY) {
    var host = graphCanvasFor(chain);
    var graph = graphState(chain);
    var bounds = host.getBoundingClientRect();
    var next = Math.max(0.35, Math.min(2.5, zoom));
    var anchorX = clientX === undefined ? bounds.width / 2 : clientX - bounds.left;
    var anchorY = clientY === undefined ? bounds.height / 2 : clientY - bounds.top;
    var worldX = (anchorX - graph.viewport.x) / graph.viewport.zoom;
    var worldY = (anchorY - graph.viewport.y) / graph.viewport.zoom;
    graph.viewport.x = anchorX - worldX * next;
    graph.viewport.y = anchorY - worldY * next;
    graph.viewport.zoom = next;
    graph.needsFit = false;
    updateGraphViewport(chain, false);
  }

  function resetGraphViewport(chain) {
    var graph = graphState(chain);
    graph.viewport = { x: 0, y: 0, zoom: 1 };
    graph.needsFit = false;
    updateGraphViewport(chain, true);
  }

  function showGraphChain(chain) {
    chain = chain === "post" ? "post" : "model";
    closeGraphContextMenu();
    state.activeGraph = chain;
    document.querySelectorAll("#chainModes [data-chain]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.chain === chain);
    });
    document.querySelectorAll(".graph-canvas[data-graph-chain]").forEach(function (canvasElement) {
      canvasElement.classList.toggle("active", canvasElement.dataset.graphChain === chain);
    });
    requestAnimationFrame(function () {
      renderGraph(chain);
      if (graphState(chain).needsFit) fitGraphToView(chain);
      else updateGraphViewport(chain, true);
    });
  }

  function fitGraphToView(chain) {
    var host = graphCanvasFor(chain);
    var scene = host.querySelector(".graph-scene");
    if (!scene || !host.clientWidth || !host.clientHeight) return;
    var nodes = Array.prototype.slice.call(scene.querySelectorAll(".graph-node"));
    if (!nodes.length) return;
    var minX = Math.min.apply(null, nodes.map(function (node) { return node.offsetLeft; }));
    var minY = Math.min.apply(null, nodes.map(function (node) { return node.offsetTop; }));
    var maxX = Math.max.apply(null, nodes.map(function (node) { return node.offsetLeft + node.offsetWidth; }));
    var maxY = Math.max.apply(null, nodes.map(function (node) { return node.offsetTop + node.offsetHeight; }));
    var padding = 24;
    var width = Math.max(1, maxX - minX);
    var height = Math.max(1, maxY - minY);
    var fitZoom = Math.min(1, (host.clientWidth - padding * 2) / width, (host.clientHeight - padding * 2) / height);
    var zoom = Math.max(0.65, fitZoom);
    var graph = graphState(chain);
    graph.viewport = {
      x: zoom > fitZoom ? padding - minX * zoom : (host.clientWidth - width * zoom) / 2 - minX * zoom,
      y: padding - minY * zoom,
      zoom: zoom
    };
    graph.needsFit = false;
    updateGraphViewport(chain, true);
  }

  function installGraphNavigation() {
    ["model", "post"].forEach(function (chain) {
      var host = graphCanvasFor(chain);
      var runtime = graphRuntime(chain);
      host.addEventListener("pointerdown", function (event) {
      var graph = graphState(chain);
      var leftBackground = event.button === 0 && !(event.target.closest && event.target.closest(".graph-node"));
      var middleAnywhere = event.button === 1;
      if (!leftBackground && !middleAnywhere) return;
      closeGraphContextMenu();
      cancelActiveGraphInteraction(chain);
      event.preventDefault();
      event.stopPropagation();
      var pointerId = event.pointerId;
      var startX = event.clientX;
      var startY = event.clientY;
      var originX = graph.viewport.x;
      var originY = graph.viewport.y;
      host.classList.add("panning");
      graph.needsFit = false;
      function move(moveEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        graph.viewport.x = originX + moveEvent.clientX - startX;
        graph.viewport.y = originY + moveEvent.clientY - startY;
        updateGraphViewport(chain, false);
      }
      function finish(finishEvent) {
        if (finishEvent && finishEvent.pointerId !== undefined && finishEvent.pointerId !== pointerId) return;
        if (runtime.activeInteraction === finish) runtime.activeInteraction = null;
        host.classList.remove("panning");
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", finish);
        document.removeEventListener("pointercancel", finish);
        window.removeEventListener("blur", finish);
        resumePreviewAfterGraphInteraction();
        flushPendingGraphRender(chain);
      }
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", finish);
      document.addEventListener("pointercancel", finish);
      window.addEventListener("blur", finish);
      runtime.activeInteraction = finish;
      pausePreviewForGraphInteraction();
      });
      host.addEventListener("wheel", function (event) {
        var graph = graphState(chain);
        event.preventDefault();
        debouncePreviewAfterGraphZoom();
        setGraphZoom(chain, graph.viewport.zoom * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
      }, { passive: false });
    });
  }

  var graphContextMenu = null;

  function closeGraphContextMenu() {
    if (!graphContextMenu) return;
    graphContextMenu.remove();
    graphContextMenu = null;
  }

  function installGraphContextMenu() {
    ["model", "post"].forEach(function (chain) {
      var host = graphCanvasFor(chain);
      host.addEventListener("contextmenu", function (event) {
      if (event.target.closest && event.target.closest(".graph-node")) return;
      event.preventDefault();
      closeGraphContextMenu();
      state.activeGraph = chain;
      var point = graphCanvasPoint(host, event);
      var menu = document.createElement("div");
      menu.className = "graph-context-menu";
      menu.setAttribute("role", "menu");
      var addShader = document.createElement("button");
      addShader.type = "button";
      addShader.setAttribute("role", "menuitem");
      addShader.textContent = chain === "model" ? "添加模型渲染" : "添加后处理";
      addShader.disabled = chain === "model" && state.modelPass >= 0;
      addShader.title = addShader.disabled ? "模型渲染节点已存在" : "";
      addShader.addEventListener("click", function () {
        closeGraphContextMenu();
        addShaderNode(chain === "model" ? "model" : "post", { left: point.x - 155, top: point.y - 18 });
      });
      menu.appendChild(addShader);
      var addTexture = document.createElement("button");
      addTexture.type = "button";
      addTexture.setAttribute("role", "menuitem");
      addTexture.textContent = "添加纹理";
      addTexture.addEventListener("click", function () {
        closeGraphContextMenu();
        addTextureCard({ left: point.x - 102, top: point.y - 18 }, chain);
      });
      menu.appendChild(addTexture);
      var addPingPong = document.createElement("button");
      addPingPong.type = "button";
      addPingPong.setAttribute("role", "menuitem");
      addPingPong.textContent = "添加 Ping-Pong";
      addPingPong.addEventListener("click", function () {
        closeGraphContextMenu();
        addPingPongCard({ left: point.x - 102, top: point.y - 18 }, chain);
      });
      menu.appendChild(addPingPong);
      document.body.appendChild(menu);
      var bounds = menu.getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(window.innerWidth - bounds.width - 8, event.clientX)) + "px";
      menu.style.top = Math.max(8, Math.min(window.innerHeight - bounds.height - 8, event.clientY)) + "px";
      graphContextMenu = menu;
      });
    });
    document.addEventListener("pointerdown", function (event) {
      if (graphContextMenu && !graphContextMenu.contains(event.target)) closeGraphContextMenu();
    }, true);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeGraphContextMenu();
    });
    window.addEventListener("blur", closeGraphContextMenu);
  }

  function installPanelResizer() {
    var content = document.querySelector(".content");
    var panel = document.querySelector(".panel");
    var handle = document.getElementById("panelResizer");
    var toggle = document.getElementById("panelCollapse");
    function setCollapsed(collapsed) {
      content.classList.toggle("panel-collapsed", collapsed);
      panel.inert = collapsed;
      panel.setAttribute("aria-hidden", collapsed ? "true" : "false");
      handle.tabIndex = collapsed ? -1 : 0;
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.setAttribute("aria-label", collapsed ? "展开设置面板" : "收起设置面板");
      toggle.title = collapsed ? "展开设置面板" : "收起设置面板";
    }
    function applyWidth(width) {
      var available = content.getBoundingClientRect().width - handle.offsetWidth;
      var minimum = Math.min(240, Math.max(160, available * 0.35));
      var maximum = Math.max(minimum, available - Math.min(240, available * 0.4));
      var next = Math.max(minimum, Math.min(maximum, width));
      content.style.setProperty("--panel-width", next + "px");
      handle.setAttribute("aria-valuenow", String(Math.round(next)));
    }
    handle.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 || content.classList.contains("panel-collapsed")) return;
      event.preventDefault();
      var pointerId = event.pointerId;
      var startX = event.clientX;
      var startWidth = panel.getBoundingClientRect().width;
      var moveFrame = null;
      var pendingWidth = null;
      handle.classList.add("resizing");
      pausePreviewForGraphInteraction();
      function applyPendingWidth() {
        moveFrame = null;
        if (pendingWidth === null) return;
        applyWidth(pendingWidth);
        pendingWidth = null;
      }
      function move(moveEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        pendingWidth = startWidth + moveEvent.clientX - startX;
        if (moveFrame === null) moveFrame = requestAnimationFrame(applyPendingWidth);
      }
      function finish(finishEvent) {
        if (finishEvent && finishEvent.pointerId !== undefined && finishEvent.pointerId !== pointerId) return;
        if (moveFrame !== null) cancelAnimationFrame(moveFrame);
        if (pendingWidth !== null) applyPendingWidth();
        handle.classList.remove("resizing");
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", finish);
        document.removeEventListener("pointercancel", finish);
        window.removeEventListener("blur", finish);
        resumePreviewAfterGraphInteraction();
      }
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", finish);
      document.addEventListener("pointercancel", finish);
      window.addEventListener("blur", finish);
    });
    handle.addEventListener("keydown", function (event) {
      if (content.classList.contains("panel-collapsed") || event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      applyWidth(panel.getBoundingClientRect().width + (event.key === "ArrowLeft" ? -16 : 16));
    });
    handle.addEventListener("dblclick", function () {
      if (content.classList.contains("panel-collapsed")) return;
      content.style.removeProperty("--panel-width");
      handle.removeAttribute("aria-valuenow");
    });
    toggle.addEventListener("click", function () {
      setCollapsed(!content.classList.contains("panel-collapsed"));
      schedulePreviewFrame();
    });
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function setModelPass(passIndex) {
    if (!Number.isInteger(passIndex) || passIndex < 0 || passIndex >= state.fragments.length || passIndex === state.modelPass) return;
    state.modelPass = passIndex;
    state.compileRevision++;
    renderGraph();
    state.interfaceWarningSignature = null;
    warnShaderInterfaces();
    graphModified();
  }

  function cycleConnection(pass, input) {
    var sources = [];
    var targetChain = chainForPass(pass);
    for (var source = 0; source < pass; source++) {
      var sourceChain = chainForPass(source);
      if (passOutput(source).supported && (sourceChain === targetChain || sourceChain === "model" && targetChain === "post")) {
        sources.push({ from: source });
      }
    }
    state.textureNodes.filter(function (textureNode) { return textureNode.chain === targetChain; }).forEach(function (textureNode) {
      if (textureById(textureNode.texture)) sources.push({ textureNode: textureNode.id });
    });
    state.pingPongs.filter(function (pingPong) { return pingPong.chain === targetChain; }).forEach(function (pingPong) {
      sources.push({ pingPong: pingPong.id });
    });
    if (!sources.length) return;
    var current = connectionSetting(pass, input);
    var currentIndex = current ? sources.findIndex(function (candidate) {
      return candidate.from === current.from && candidate.textureNode === current.textureNode && candidate.pingPong === current.pingPong;
    }) : -1;
    if (current && currentIndex === sources.length - 1) setConnection(pass, input, null);
    else setConnection(pass, input, sources[(currentIndex + 1) % sources.length]);
  }

  function cyclePingPongInput(id) {
    var pingPong = pingPongById(id);
    if (!pingPong) return;
    var sources = [];
    state.fragments.forEach(function (_, index) {
      var sourceChain = chainForPass(index);
      if (passOutput(index).supported && (sourceChain === pingPong.chain || sourceChain === "model" && pingPong.chain === "post")) {
        sources.push(index);
      }
    });
    if (!sources.length) return;
    var currentIndex = sources.indexOf(pingPong.from);
    setPingPongInput(id, currentIndex === sources.length - 1 ? null : sources[(currentIndex + 1) % sources.length]);
  }

  function togglePause(button) {
    state.paused = !state.paused;
    if (state.paused) {
      state.pausedAt = performance.now();
      button.textContent = ">";
      button.classList.add("resume");
      setStatus("已暂停");
    } else {
      var now = performance.now();
      if (state.pausedAt !== null) state.startedAt += now - state.pausedAt;
      state.pausedAt = null;
      state.runtimeErrorLogged = false;
      button.textContent = "II";
      button.classList.remove("resume");
      setStatus("运行中", "running");
      schedulePreviewFrame();
    }
  }

  function resetPreview() {
    if (state.autoCompileTimer !== null) clearTimeout(state.autoCompileTimer);
    resumePreviewAfterGraphInteraction();
    closeGraphContextMenu();
    ["model", "post"].forEach(function (chain) {
      cancelActiveGraphInteraction(chain);
      var runtime = graphRuntime(chain);
      if (runtime.viewportFrame !== null) cancelAnimationFrame(runtime.viewportFrame);
      if (runtime.backgroundTimer !== null) clearTimeout(runtime.backgroundTimer);
      runtime.viewportFrame = null;
      runtime.backgroundTimer = null;
      runtime.renderPending = false;
    });
    state.previewRevision++;
    state.compileRevision++;
    state.readingRevision = null;
    state.vertex = null;
    state.postVertex = null;
    state.fragments = [];
    state.connections = [];
    state.pingPongs = [];
    state.blackInputs = {};
    state.activeConnections = [];
    state.nextPingPongId = 1;
    state.textureImportRevisions = {};
    state.textureNodes = [];
    state.nextTextureNodeId = 1;
    state.autoCompileTimer = null;
    state.autoCompileBlocked = false;
    state.outputPass = -1;
    state.activeOutputPass = -1;
    state.modelPass = -1;
    state.graphs = createGraphStates();
    state.activeGraph = "model";
    state.selectedShader = { stage: "vertex", index: 0 };
    state.uniforms = {};
    state.uniformTypes = {};
    state.matrixInputs = {};
    state.attributeInputs = {};
    state.uniformValueCache = new WeakMap();
    state.builtinAliases = defaultBuiltinAliases();
    state.interfaceWarningSignature = null;
    state.scannedUniforms = [];
    state.passes.forEach(disposePass);
    state.passes = [];
    state.activePingPongs.forEach(disposePingPongRuntime);
    state.activePingPongs = [];
    if (state.obj) {
      var key = "obj:" + state.obj.path;
      disposeGeometry(geometryCache[key]);
      delete geometryCache[key];
    }
    var texturesToDispose = state.textures.concat(state.retiredTextures);
    texturesToDispose.forEach(function (texture, index) {
      if (!gl || texturesToDispose.slice(0, index).some(function (previous) { return previous.glTexture === texture.glTexture; })) return;
      gl.deleteTexture(texture.glTexture);
    });
    state.textures = [];
    state.retiredTextures = [];
    state.obj = null;
    state.geometry = "sphere";
    state.tick = 0;
    state.paused = false;
    state.pausedAt = null;
    state.runtimeErrorLogged = false;
    state.startedAt = performance.now();
    document.getElementById("pause").textContent = "II";
    document.getElementById("pause").classList.remove("resume");
    var vertexName = document.getElementById("vertexName");
    if (vertexName) vertexName.textContent = "选择 .vertex、.vert、.vsh 或 .glsl";
    document.getElementById("postVertexName").textContent = "未绑定时使用内置全屏三角形";
    document.getElementById("tickAliases").value = state.builtinAliases.tick;
    document.getElementById("timeAliases").value = state.builtinAliases.time;
    document.getElementById("objPicker").classList.add("hidden");
    document.getElementById("objName").classList.add("hidden");
    document.querySelectorAll("[data-geometry]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.geometry === "sphere");
    });
    document.querySelectorAll("#chainModes [data-chain]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.chain === "model");
    });
    document.querySelectorAll(".graph-canvas[data-graph-chain]").forEach(function (canvasElement) {
      canvasElement.classList.toggle("active", canvasElement.dataset.graphChain === "model");
    });
    renderPassSlots();
    renderTextures();
    mergeScannedUniforms();
    renderGraph();
    setStatus("空闲");
    document.getElementById("canvasMessage").classList.remove("hidden");
  }

  function chooseObj() {
    var previewRevision = state.previewRevision;
    ide("chooseObj").then(function (response) {
      if (previewRevision !== state.previewRevision || response.cancelled) return;
      if (response.error) throw new Error(response.error);
      if (!response.obj) return;
      response.obj.mesh = parseObj(response.obj.source);
      var previousKey = state.obj ? "obj:" + state.obj.path : null;
      var nextKey = "obj:" + response.obj.path;
      if (previousKey) {
        disposeGeometry(geometryCache[previousKey]);
        delete geometryCache[previousKey];
      }
      if (nextKey !== previousKey) {
        disposeGeometry(geometryCache[nextKey]);
        delete geometryCache[nextKey];
      }
      state.obj = response.obj;
      document.getElementById("objName").textContent = response.obj.name;
      document.getElementById("objName").classList.remove("hidden");
      log("已导入 OBJ：" + response.obj.name, "success");
    }).catch(function (error) {
      if (previewRevision === state.previewRevision) log("无法导入 OBJ：" + error.message, "error");
    });
  }

  document.getElementById("compile").addEventListener("click", compileAll);
  document.getElementById("vertexBrowse").addEventListener("click", function () { chooseShader("vertex", 0); });
  document.getElementById("vertexClear").addEventListener("click", function () { clearVertexShader("vertex"); });
  document.getElementById("postVertexBrowse").addEventListener("click", function () { chooseShader("postVertex", 0); });
  document.getElementById("postVertexClear").addEventListener("click", function () { clearVertexShader("postVertex"); });
  ["tick", "time"].forEach(function (kind) {
    var input = document.getElementById(kind + "Aliases");
    function applyAliases(normalize) {
      var names = aliasNamesFromText(input.value);
      if (!names.length) {
        if (!normalize) return;
        names = [kind];
      }
      state.builtinAliases[kind] = names.join(", ");
      if (normalize) input.value = state.builtinAliases[kind];
      mergeScannedUniforms();
      state.passes.forEach(function (pass, passIndex) {
        pass.values = captureUniformValues(pass.uniforms, passIndex);
      });
      renderGraph();
      schedulePreviewFrame();
    }
    input.addEventListener("input", function () { applyAliases(false); });
    input.addEventListener("change", function () { applyAliases(true); });
  });
  document.getElementById("pause").addEventListener("click", function () { togglePause(this); });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) schedulePreviewFrame();
  });
  document.getElementById("clearConsole").addEventListener("click", function () { document.getElementById("console").textContent = ""; });
  document.getElementById("newPreview").addEventListener("click", resetPreview);
  document.getElementById("resetCamera").addEventListener("click", function () { state.yaw=.55; state.pitch=.28; document.getElementById("cameraDistance").value="4.5"; document.getElementById("cameraFov").value="45"; schedulePreviewFrame(); });
  document.getElementById("frameModel").addEventListener("click", function () { document.getElementById("resetCamera").click(); });
  document.getElementById("autoLayout").addEventListener("click", function () {
    var graph = graphState(state.activeGraph);
    graph.positions = {};
    graph.viewport = { x: 0, y: 0, zoom: 1 };
    graph.needsFit = true;
    renderGraph(state.activeGraph);
  });
  document.getElementById("zoomOut").addEventListener("click", function () {
    var chain = state.activeGraph;
    setGraphZoom(chain, graphState(chain).viewport.zoom / 1.2);
  });
  document.getElementById("zoomIn").addEventListener("click", function () {
    var chain = state.activeGraph;
    setGraphZoom(chain, graphState(chain).viewport.zoom * 1.2);
  });
  document.getElementById("resetZoom").addEventListener("click", function () { resetGraphViewport(state.activeGraph); });
  document.querySelectorAll("#chainModes [data-chain]").forEach(function (button) {
    button.addEventListener("click", function () { showGraphChain(button.dataset.chain); });
  });
  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab,.view").forEach(function (element) { element.classList.remove("active"); });
      tab.classList.add("active");
      document.getElementById(tab.dataset.view + "View").classList.add("active");
      document.querySelector(".content").classList.toggle("graph-mode", tab.dataset.view === "graph");
      if (tab.dataset.view === "graph") requestAnimationFrame(function () {
        renderGraph(state.activeGraph);
        if (graphState(state.activeGraph).needsFit) fitGraphToView(state.activeGraph);
      });
    });
  });
  document.querySelectorAll("[data-geometry]").forEach(function (button) { button.addEventListener("click", function () { document.querySelectorAll("[data-geometry]").forEach(function (item) { item.classList.remove("active"); }); button.classList.add("active"); state.geometry=button.dataset.geometry; var show=state.geometry==="obj"; document.getElementById("objPicker").classList.toggle("hidden",!show); document.getElementById("objName").classList.toggle("hidden",!show||!state.obj); schedulePreviewFrame(); }); });
  document.getElementById("objPicker").addEventListener("click", chooseObj);
  document.addEventListener("dragover", function (event) {
    var paths = droppedPathsFromTransfer(event.dataTransfer);
    if (!paths.length) {
      paths = Array.prototype.map.call(event.dataTransfer.files || [], function (file) { return file.name; });
    }
    var target = event.target.closest ? event.target.closest("[data-drop-stage]") : null;
    if (!target || !compatibleDropPath(paths, target.dataset.dropStage)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    showDropTarget(target, paths);
  });
  document.addEventListener("dragleave", function (event) {
    if (!event.relatedTarget) clearDropTarget();
  });
  document.addEventListener("drop", function (event) {
    var target = event.target.closest ? event.target.closest("[data-drop-stage]") : null;
    var paths = droppedPathsFromTransfer(event.dataTransfer);
    if (!target || !compatibleDropPath(paths, target.dataset.dropStage)) return;
    event.preventDefault();
    handleDroppedPaths(paths, event.clientX / window.innerWidth, event.clientY / window.innerHeight);
  });
  canvas.addEventListener("pointerdown", function (event) { state.dragging=true; state.pointerX=event.clientX; state.pointerY=event.clientY; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener("pointermove", function (event) { if (!state.dragging) return; state.yaw -= (event.clientX-state.pointerX)*.008; state.pitch=Math.max(-1.3,Math.min(1.3,state.pitch+(event.clientY-state.pointerY)*.008)); state.pointerX=event.clientX; state.pointerY=event.clientY; schedulePreviewFrame(); });
  canvas.addEventListener("pointerup", function () { state.dragging=false; });
  canvas.addEventListener("wheel", function (event) { var input=document.getElementById("cameraDistance"); input.value=String(Math.max(1.5,Math.min(12,Number(input.value)+event.deltaY*.005))); schedulePreviewFrame(); event.preventDefault(); }, { passive:false });
  document.getElementById("cameraDistance").addEventListener("input", schedulePreviewFrame);
  document.getElementById("cameraFov").addEventListener("input", schedulePreviewFrame);
  window.addEventListener("resize", schedulePreviewFrame);

  if (!gl) {
    log("当前环境不支持 WebGL2，渲染已禁用。", "error");
    setStatus("不可用", "error");
  }
  installGraphNavigation();
  installGraphContextMenu();
  installPanelResizer();
  renderPassSlots();
  renderTextures();
  connectDefaultPasses();
  mergeScannedUniforms();
  renderGraph();
  schedulePreviewFrame();
}());
