package glsl.plugin.preview.ui

import com.google.gson.Gson
import com.intellij.ide.dnd.DnDEvent
import com.intellij.ide.dnd.DnDSupport
import com.intellij.ide.dnd.FileCopyPasteUtil
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.fileChooser.FileChooserFactory
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.psi.PsiDocumentManager
import com.intellij.psi.PsiManager
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import glsl.data.ShaderType
import glsl.plugin.language.GlslFile
import glsl.plugin.preview.analysis.GlslInterfaceScanner
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.awt.BorderLayout
import java.awt.event.HierarchyEvent
import java.awt.event.HierarchyListener
import java.util.Base64
import javax.swing.JComponent

class ShaderPreviewToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val content = toolWindow.contentManager.factory.createContent(
            createComponent(project, toolWindow.disposable),
            null,
            false,
        )
        toolWindow.contentManager.addContent(content)
    }

    private fun createComponent(project: Project, parentDisposable: Disposable): JComponent {
        if (!JBCefApp.isSupported()) {
            return JBPanel<JBPanel<*>>(BorderLayout()).apply {
                add(JBLabel("着色器预览需要 IDE 自带的 JCEF 运行时。"), BorderLayout.CENTER)
            }
        }

        val browser = JBCefBrowser.createBuilder()
            .setWindowlessFramerate(60)
            .build()
        val bridge = ShaderPreviewBridge(project, browser)
        Disposer.register(parentDisposable, browser)
        Disposer.register(parentDisposable, bridge)
        installPreviewDropTarget(browser, parentDisposable)
        installPreviewVisibilitySync(browser, parentDisposable)
        browser.loadHTML(
            loadPreviewHtml(
                bridge.query.inject(
                    "request",
                    "resolve",
                    "function(errorCode, errorMessage) { reject(new Error(errorMessage)); }",
                ),
            ),
        )
        return browser.component
    }

    private fun loadPreviewHtml(queryCall: String): String {
        val template = checkNotNull(javaClass.getResource("/preview/index.html")) {
            "缺少预览资源：/preview/index.html"
        }.readText(Charsets.UTF_8)
        val styles = checkNotNull(javaClass.getResource("/preview/style.css")).readText(Charsets.UTF_8)
        val three = checkNotNull(javaClass.getResource("/preview/vendor/three.min.js")).readText(Charsets.UTF_8)
        val script = checkNotNull(javaClass.getResource("/preview/app.js")).readText(Charsets.UTF_8)
        return template
            .replace("__PREVIEW_STYLE__", styles)
            .replace("__THREE_SCRIPT__", three)
            .replace("__PREVIEW_SCRIPT__", script)
            .replace("__IDE_QUERY__", queryCall)
    }
}

private fun installPreviewVisibilitySync(browser: JBCefBrowser, parentDisposable: Disposable) {
    val component = browser.component
    val syncVisibility = {
        browser.runJavaScript(
            "window.shaderPreviewSetWindowVisible && window.shaderPreviewSetWindowVisible(${component.isShowing});",
        )
    }
    val listener = HierarchyListener { event ->
        if (event.changeFlags and HierarchyEvent.SHOWING_CHANGED.toLong() == 0L) return@HierarchyListener
        syncVisibility()
    }
    component.addHierarchyListener(listener)
    browser.jbCefClient.addLoadHandler(
        object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(browser: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
                if (frame?.isMain != true) return
                ApplicationManager.getApplication().invokeLater {
                    if (!Disposer.isDisposed(parentDisposable)) syncVisibility()
                }
            }
        },
        browser.cefBrowser,
    )
    Disposer.register(parentDisposable) { component.removeHierarchyListener(listener) }
}

private val previewDropExtensions = setOf(
    "glsl", "vert", "vsh", "vertex", "frag", "fsh", "fragment",
    "png", "jpg", "jpeg", "webp", "bmp", "gif",
)

private fun installPreviewDropTarget(browser: JBCefBrowser, parentDisposable: Disposable) {
    DnDSupport.createBuilder(browser.component)
        .enableAsNativeTarget()
        .setTargetChecker { event ->
            val paths = event.previewDropPaths()
            val accepted = paths.isNotEmpty()
            event.setDropPossible(accepted, if (accepted) "拖放到兼容的着色器或纹理卡片" else "不支持此文件类型")
            if (accepted) browser.notifyPreviewDrop("shaderPreviewDragFromIde", paths, event)
            accepted
        }
        .setDropHandler { event ->
            val paths = event.previewDropPaths()
            if (paths.isNotEmpty()) browser.notifyPreviewDrop("shaderPreviewDropFromIde", paths, event)
        }
        .setCleanUpOnLeaveCallback {
            browser.runJavaScript("window.shaderPreviewClearDropTarget && window.shaderPreviewClearDropTarget();")
        }
        .setDisposableParent(parentDisposable)
        .install()
}

private fun DnDEvent.previewDropPaths(): List<String> {
    val attached = FileCopyPasteUtil.getFileListFromAttachedObject(attachedObject)
    val transferred = FileCopyPasteUtil.getFileList(this).orEmpty()
    return (attached + transferred)
        .asSequence()
        .map { it.absoluteFile.normalize().path }
        .filter { path -> path.substringAfterLast('.', "").lowercase() in previewDropExtensions }
        .distinct()
        .toList()
}

private fun JBCefBrowser.notifyPreviewDrop(function: String, paths: List<String>, event: DnDEvent) {
    val point = event.getPointOn(component)
    val x = point.x.toDouble() / component.width.coerceAtLeast(1)
    val y = point.y.toDouble() / component.height.coerceAtLeast(1)
    runJavaScript(
        "window.$function && window.$function(${Gson().toJson(paths)}, $x, $y);",
    )
}

private class ShaderPreviewBridge(
    private val project: Project,
    browser: JBCefBrowser,
) : Disposable {
    private val gson = Gson()
    val query: JBCefJSQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)

    init {
        query.addHandler { request ->
            JBCefJSQuery.Response(handleRequest(request))
        }
    }

    private fun handleRequest(request: String): String {
        val message = runCatching { gson.fromJson(request, BridgeRequest::class.java) }.getOrNull()
            ?: return gson.toJson(BridgeResponse(error = "请求格式无效"))
        return runCatching {
            when (message.action) {
                "chooseShader" -> chooseShader(message.stage)
                "chooseObj" -> chooseObj()
                "chooseTexture" -> chooseTexture()
                "readFiles" -> readFiles(message.files)
                "readTexture" -> readTexture(message.path)
                else -> gson.toJson(BridgeResponse(error = "未知操作：${message.action}"))
            }
        }.getOrElse { error ->
            gson.toJson(BridgeResponse(error = error.message ?: "预览请求失败"))
        }
    }

    private fun chooseShader(stage: String?): String {
        val extensions = when (stage) {
            "vertex" -> arrayOf("glsl", "vert", "vsh", "vertex")
            "fragment" -> arrayOf("glsl", "frag", "fsh", "fragment")
            else -> arrayOf("glsl", "vert", "vsh", "vertex", "frag", "fsh", "fragment")
        }
        val file = chooseFile(
            title = "选择着色器源码",
            extensions = extensions,
        ) ?: return gson.toJson(BridgeResponse(cancelled = true))

        val snapshot = snapshotShaderFile(project, file, stage ?: inferStage(file), null)
        return gson.toJson(BridgeResponse(file = snapshot))
    }

    private fun readFiles(requests: List<BridgeFileRequest>?): String {
        val snapshots = mutableListOf<ShaderFileSnapshot>()
        for (request in requests.orEmpty()) {
            val path = request.path
                ?: return gson.toJson(BridgeResponse(error = "缺少着色器文件路径"))
            val file = LocalFileSystem.getInstance().refreshAndFindFileByPath(path)
                ?: return gson.toJson(BridgeResponse(error = "着色器文件已不存在：$path"))
            snapshots += snapshotShaderFile(project, file, request.stage ?: inferStage(file), request.slot)
        }
        return gson.toJson(BridgeResponse(files = snapshots))
    }

    private fun chooseObj(): String {
        val file = chooseFile("选择 OBJ 模型", arrayOf("obj"))
            ?: return gson.toJson(BridgeResponse(cancelled = true))
        val source = ReadAction.computeBlocking<String, RuntimeException> {
            val document = FileDocumentManager.getInstance().getDocument(file)
            document?.text ?: String(file.contentsToByteArray(), Charsets.UTF_8)
        }
        return gson.toJson(
            BridgeResponse(
                obj = ObjSnapshot(file.path, file.name, source),
            ),
        )
    }

    private fun chooseTexture(): String {
        val file = chooseFile("选择纹理图片", imageExtensions.toTypedArray())
            ?: return gson.toJson(BridgeResponse(cancelled = true))
        return gson.toJson(BridgeResponse(texture = textureSnapshot(file)))
    }

    private fun readTexture(path: String?): String {
        if (path == null) return gson.toJson(BridgeResponse(error = "缺少纹理文件路径"))
        val file = LocalFileSystem.getInstance().refreshAndFindFileByPath(path)
            ?: return gson.toJson(BridgeResponse(error = "纹理文件已不存在：$path"))
        return gson.toJson(BridgeResponse(texture = textureSnapshot(file)))
    }

    private fun chooseFile(title: String, extensions: Array<String>): VirtualFile? {
        var selected: VirtualFile? = null
        val choose = Runnable {
            val descriptor = FileChooserDescriptor(true, false, false, false, false, false)
                .withTitle(title)
                .withExtensionFilter(title, *extensions)
            project.baseDir?.let { descriptor.withRoots(it) }
            selected = FileChooserFactory.getInstance()
                .createFileChooser(descriptor, project, null)
                .choose(project)
                .firstOrNull()
        }
        runOnEdt(choose)
        return selected
    }

    private fun inferStage(file: VirtualFile): String = when (ShaderType.fromFileExtension(file.extension)) {
        ShaderType.VERT -> "vertex"
        ShaderType.FRAG -> "fragment"
        else -> "unknown"
    }

    override fun dispose() {
        query.dispose()
    }
}

private data class BridgeRequest(
    val action: String? = null,
    val stage: String? = null,
    val path: String? = null,
    val files: List<BridgeFileRequest>? = null,
)

private data class BridgeFileRequest(
    val path: String? = null,
    val stage: String? = null,
    val slot: Int? = null,
)

private data class BridgeResponse(
    val file: ShaderFileSnapshot? = null,
    val files: List<ShaderFileSnapshot>? = null,
    val obj: ObjSnapshot? = null,
    val texture: TextureSnapshot? = null,
    val cancelled: Boolean = false,
    val error: String? = null,
)

internal data class ShaderFileSnapshot(
    val path: String,
    val name: String,
    val stage: String,
    val slot: Int?,
    val source: String,
    val interfaces: List<ShaderInterfaceSnapshot>,
)

internal data class ShaderInterfaceSnapshot(
    val storage: String,
    val name: String,
    val type: String,
    val array: String?,
    val layout: Map<String, String?>,
    val builtin: Boolean,
)

private data class ObjSnapshot(
    val path: String,
    val name: String,
    val source: String,
)

private val imageExtensions = setOf("png", "jpg", "jpeg", "webp", "bmp", "gif")

private data class TextureSnapshot(
    val path: String,
    val name: String,
    val dataUrl: String,
)

private data class DocumentState(
    val document: com.intellij.openapi.editor.Document?,
    val needsCommit: Boolean,
)

internal fun snapshotShaderFile(
    project: Project,
    file: VirtualFile,
    stage: String,
    slot: Int?,
): ShaderFileSnapshot {
    val documentState = ReadAction.computeBlocking<DocumentState, RuntimeException> {
        val document = FileDocumentManager.getInstance().getDocument(file)
        DocumentState(
            document = document,
            needsCommit = document != null && !PsiDocumentManager.getInstance(project).isCommitted(document),
        )
    }
    if (documentState.needsCommit) {
        runOnEdt {
            PsiDocumentManager.getInstance(project).commitDocument(checkNotNull(documentState.document))
        }
    }
    return ReadAction.computeBlocking<ShaderFileSnapshot, RuntimeException> {
        val source = documentState.document?.text ?: String(file.contentsToByteArray(), Charsets.UTF_8)
        val psiFile = PsiManager.getInstance(project).findFile(file) as? GlslFile
        val interfaces = psiFile?.let(GlslInterfaceScanner::scan)?.variables.orEmpty()
            .map { variable ->
                ShaderInterfaceSnapshot(
                    storage = variable.storage.name.lowercase(),
                    name = variable.name,
                    type = variable.typeText,
                    array = variable.arrayText,
                    layout = variable.layout,
                    builtin = variable.isBuiltin,
                )
            }
        ShaderFileSnapshot(
            path = file.path,
            name = file.name,
            stage = stage,
            slot = slot,
            source = source,
            interfaces = interfaces,
        )
    }
}

private fun textureSnapshot(file: VirtualFile): TextureSnapshot {
    val extension = file.extension?.lowercase()
    require(extension in imageExtensions) { "不支持的纹理格式：${file.name}" }
    val bytes = ReadAction.computeBlocking<ByteArray, RuntimeException> { file.contentsToByteArray() }
    val mimeType = when (extension) {
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "bmp" -> "image/bmp"
        "gif" -> "image/gif"
        else -> "image/png"
    }
    return TextureSnapshot(
        path = file.path,
        name = file.name,
        dataUrl = "data:$mimeType;base64,${Base64.getEncoder().encodeToString(bytes)}",
    )
}

private fun runOnEdt(action: Runnable) {
    val application = ApplicationManager.getApplication()
    if (application.isDispatchThread) action.run() else application.invokeAndWait(action)
}
