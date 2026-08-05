window.__fragmentPick = 0;
window.__vertexPick = 0;
window.__texturePick = 0;
window.__forceImageUploadFallback = new URLSearchParams(window.location.search).get("forceTextureFallback") === "1";
window.__uniformValues = {};
window.__uniformLog = [];

(function () {
  var prototype = WebGL2RenderingContext.prototype;
  var uniformNames = new WeakMap();
  var getUniformLocation = prototype.getUniformLocation;
  var texImage2D = prototype.texImage2D;
  prototype.getUniformLocation = function (program, name) {
    var location = getUniformLocation.call(this, program, name);
    if (location) uniformNames.set(location, name);
    return location;
  };
  ["uniform1f", "uniform1i", "uniform1ui"].forEach(function (method) {
    var original = prototype[method];
    prototype[method] = function (location, value) {
      var name = uniformNames.get(location);
      if (name === "iteration" || name === "phase" || name === "time" || name === "uTime") {
        window.__uniformValues[name] = value;
        window.__uniformLog.push(name + ":" + value);
        if (window.__uniformLog.length > 24) window.__uniformLog.shift();
        document.documentElement.setAttribute("data-" + name, String(value));
        document.documentElement.setAttribute("data-uniform-log", window.__uniformLog.join(","));
      }
      return original.apply(this, arguments);
    };
  });
  prototype.texImage2D = function () {
    if (window.__forceImageUploadFallback && arguments.length === 6 && arguments[5] instanceof HTMLImageElement) {
      window.__forceImageUploadFallback = false;
      texImage2D.call(this, this.TEXTURE_2D, -1, this.RGBA8, 1, 1, 0, this.RGBA, this.UNSIGNED_BYTE, null);
      return;
    }
    return texImage2D.apply(this, arguments);
  };
}());

var baseFragment = {
  path: "/test/base.fsh",
  name: "base.fsh",
  stage: "fragment",
  slot: 0,
  source: "#version 330 core\nin vec2 uv;\nuniform sampler2D tex1;\nuniform sampler2D tex2;\nuniform int iFrame;\nuniform float time;\nuniform float uTime;\nuniform vec3 badTime;\nuniform vec3 color;\nuniform vec3 sharedTint;\nout vec4 FragColor;\nvoid main(){FragColor=vec4((color+sharedTint*0.01+badTime*0.001)*0.8+vec3(uv,fract(time+uTime))*0.01+vec3(float(iFrame%2)*0.005),1.0);}",
  interfaces: [
    { storage: "in", name: "uv", type: "vec2", array: null, layout: {}, builtin: false },
    { storage: "uniform", name: "tex1", type: "sampler2D", array: null, layout: {}, builtin: false },
    { storage: "uniform", name: "tex2", type: "sampler2D", array: null, layout: {}, builtin: false },
    { storage: "uniform", name: "iFrame", type: "int", array: null, layout: {}, builtin: false },
    { storage: "uniform", name: "time", type: "float", array: null, layout: {}, builtin: true },
    { storage: "uniform", name: "uTime", type: "float", array: null, layout: {}, builtin: false },
    { storage: "uniform", name: "badTime", type: "vec3", array: null, layout: {}, builtin: false },
    { storage: "uniform", name: "color", type: "vec3", array: null, layout: {}, builtin: false },
    { storage: "uniform", name: "sharedTint", type: "vec3", array: null, layout: {}, builtin: false },
    { storage: "out", name: "FragColor", type: "vec4", array: null, layout: {}, builtin: false }
  ]
};

var modelVertex = {
  path: "/test/point_uv.vsh",
  name: "point_uv.vsh",
  stage: "vertex",
  slot: 0,
  source: "#version 330 core\nlayout(location=0) in vec3 pos;\nlayout(location=1) in vec2 aUv;\nuniform mat4 projMat;\nuniform mat4 transMat;\nuniform mat4 viewMat;\nuniform vec3 sharedTint;\nout vec2 uv;\nvoid main(){gl_Position=projMat*viewMat*transMat*vec4(pos+sharedTint*0.000001,1.0);uv=aUv;}",
  interfaces: [
    { storage: "in", name: "pos", type: "vec3", array: null, layout: { location: "0" }, builtin: false },
    { storage: "in", name: "aUv", type: "vec2", array: null, layout: { location: "1" }, builtin: false },
    { storage: "uniform", name: "projMat", type: "mat4", array: null, layout: {}, builtin: false },
    { storage: "uniform", name: "transMat", type: "mat4", array: null, layout: {}, builtin: false },
    { storage: "uniform", name: "viewMat", type: "mat4", array: null, layout: {}, builtin: false },
    { storage: "uniform", name: "sharedTint", type: "vec3", array: null, layout: {}, builtin: false },
    { storage: "out", name: "uv", type: "vec2", array: null, layout: {}, builtin: false }
  ]
};

var postVertex = {
  path: "/test/post.vsh",
  name: "post.vsh",
  stage: "vertex",
  slot: 0,
  source: "#version 330 core\nin vec3 position;\nin vec3 pos;\nin vec2 aUv;\nout vec2 screenUv;\nvoid main(){gl_Position=vec4(position.xy+pos.xy*0.000001,0.0,1.0);screenUv=aUv;}",
  interfaces: [
    { storage: "in", name: "position", type: "vec3", array: null, layout: {}, builtin: false },
    { storage: "in", name: "pos", type: "vec3", array: null, layout: {}, builtin: false },
    { storage: "in", name: "aUv", type: "vec2", array: null, layout: {}, builtin: false },
    { storage: "out", name: "screenUv", type: "vec2", array: null, layout: { location: "SLOT" }, builtin: false }
  ]
};

var mismatchedFragment = {
  path: "/test/mismatch.fsh",
  name: "mismatch.fsh",
  stage: "fragment",
  slot: 2,
  source: "#version 330 core\nin vec3 screenUv;\nout vec4 FragColor;\nvoid main(){FragColor=vec4(screenUv,1.0);}",
  interfaces: [
    { storage: "in", name: "screenUv", type: "vec3", array: "[2]", layout: { location: " SLOT " }, builtin: false },
    { storage: "out", name: "FragColor", type: "vec4", array: null, layout: {}, builtin: false }
  ]
};

var locationMismatchFragment = {
  path: "/test/location-mismatch.fsh",
  name: "location-mismatch.fsh",
  stage: "fragment",
  slot: 2,
  source: "#version 330 core\nin vec2 screenUv;\nout vec4 FragColor;\nvoid main(){FragColor=vec4(screenUv,0.0,1.0);}",
  interfaces: [
    { storage: "in", name: "screenUv", type: "vec2", array: null, layout: { location: "OTHER_SLOT" }, builtin: false },
    { storage: "out", name: "FragColor", type: "vec4", array: null, layout: {}, builtin: false }
  ]
};

var postFragment = {
  path: "/test/post.fsh",
  name: "post.fsh",
  stage: "fragment",
  slot: 1,
  source: "#version 330 core\nin vec2 screenUv;\nuniform sampler2D sourceTexture;\nuniform vec3 color;\nuniform int iteration;\nuniform int phase;\nout vec4 FragColor;\nvoid main(){vec4 sampled=texture(sourceTexture,screenUv);float marker=float(iteration+phase)*0.0001;FragColor=sampled*vec4(color,1.0)+vec4(marker,0.0,0.0,0.0);}",
  interfaces: [
    { storage: "in", name: "screenUv", type: "vec2", array: null, layout: { location: " SLOT " }, builtin: false },
    { storage: "uniform", name: "sourceTexture", type: "sampler2D", array: null, layout: {}, builtin: false },
    { storage: "uniform", name: "color", type: "vec3", array: null, layout: {}, builtin: false },
    { storage: "uniform", name: "iteration", type: "int", array: null, layout: {}, builtin: false },
    { storage: "uniform", name: "phase", type: "int", array: null, layout: {}, builtin: false },
    { storage: "out", name: "FragColor", type: "vec4", array: null, layout: {}, builtin: false }
  ]
};

var textureSnapshot = {
  path: "/test/red.png",
  name: "red.png",
  dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAZ4f6WQAAAABJRU5ErkJggg=="
};

window.__bridge = function (raw) {
  var message = JSON.parse(raw);
  if (message.action === "chooseShader" && message.stage === "vertex") {
    window.__vertexPick++;
    return { file: window.__vertexPick === 1 ? modelVertex : postVertex };
  }
  if (message.action === "chooseShader" && message.stage === "fragment") {
    window.__fragmentPick++;
    return { file: window.__fragmentPick === 1 ? baseFragment : window.__fragmentPick === 2 ? postFragment :
      window.__fragmentPick === 3 ? mismatchedFragment : locationMismatchFragment };
  }
  if (message.action === "readFiles") {
    var forceInterfaceMismatch = document.getElementById("cameraFov").value === "99";
    return {
      files: (message.files || []).map(function (request) {
        var source = request.stage === "vertex" || request.stage === "postVertex" ?
          (request.path.indexOf("post") >= 0 ? postVertex : modelVertex) :
          request.path.indexOf("location-mismatch") >= 0 ? locationMismatchFragment :
          request.path.indexOf("mismatch") >= 0 ? mismatchedFragment : request.path.indexOf("post") >= 0 ?
          (forceInterfaceMismatch ? locationMismatchFragment : postFragment) : baseFragment;
        return Object.assign({}, source, { stage: request.stage, slot: request.slot });
      })
    };
  }
  if (message.action === "chooseTexture") {
    if (new URLSearchParams(window.location.search).get("directTexturePicker") === "1") {
      window.__texturePick++;
      return {
        texture: Object.assign({}, textureSnapshot, {
          path: window.__texturePick === 1 ? "/test/red.png" : "/test/replacement.png",
          name: window.__texturePick === 1 ? "red.png" : "replacement.png"
        })
      };
    }
    return { nativePicker: true };
  }
  if (message.action === "readTexture") {
    return { texture: textureSnapshot };
  }
  return { cancelled: true };
};
