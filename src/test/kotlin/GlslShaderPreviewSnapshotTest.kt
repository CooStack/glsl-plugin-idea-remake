import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import glsl.plugin.preview.ui.snapshotShaderFile
import java.util.concurrent.Callable
import java.util.concurrent.TimeUnit

class GlslShaderPreviewSnapshotTest : BasePlatformTestCase() {

    fun testReadsShaderSnapshotFromBackgroundThread() {
        val file = myFixture.configureByText(
            "BackgroundPreview.fsh",
            """
                layout(location = 1) in vec2 uv;
                uniform sampler2D colorTexture;
                uniform sampler2D secondaryTexture;
                uniform float time;
                out vec4 color;
                void main() { color = texture(colorTexture, uv + vec2(time)); }
            """.trimIndent(),
        ).virtualFile

        val future = ApplicationManager.getApplication().executeOnPooledThread(Callable {
            snapshotShaderFile(project, file, "fragment", 0)
        })
        val snapshot = future.get(30, TimeUnit.SECONDS)

        assertEquals(file.path, snapshot.path)
        assertEquals("fragment", snapshot.stage)
        assertEquals(0, snapshot.slot)
        assertContainsElements(snapshot.interfaces.map { it.name }, "uv", "colorTexture", "secondaryTexture", "time", "color")
        val fragmentInput = snapshot.interfaces.first { it.name == "uv" }
        assertEquals("in", fragmentInput.storage)
        assertEquals("vec2", fragmentInput.type)
        assertEquals(mapOf("location" to "1"), fragmentInput.layout)
    }
}
