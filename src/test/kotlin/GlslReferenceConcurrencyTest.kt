import com.intellij.openapi.application.ApplicationManager
import com.intellij.psi.util.PsiTreeUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import glsl.plugin.psi.GlslVariable
import glsl.plugin.psi.GlslType
import glsl.plugin.reference.GlslTypeReference
import glsl.plugin.reference.GlslVariableReference
import glsl.plugin.reference.FilterType.CONTAINS
import java.util.concurrent.TimeUnit

class GlslReferenceConcurrencyTest : BasePlatformTestCase() {

    fun testConcurrentSwizzleCompletionUsesIndependentResults() {
        val file = myFixture.configureByText(
            "ConcurrentSwizzle.fsh",
            "void main() { vec4 color = vec4(0.).rgba; }",
        )
        val member = PsiTreeUtil.findChildrenOfType(file, GlslVariable::class.java)
            .first { it.name == "rgba" }
        val reference = member.reference!!
        val application = ApplicationManager.getApplication()

        val futures = List(8) { worker ->
            application.executeOnPooledThread {
                repeat(50) {
                    application.runReadAction {
                        when (worker % 3) {
                            0 -> assertEquals("rgba", reference.resolve()?.name)
                            1 -> assertContainsElements(
                                reference.variants.map { variant -> variant.lookupString },
                                "rgba",
                            )
                            else -> assertEquals(listOf("rgba"), reference.resolveMany().map { it.name })
                        }
                    }
                }
            }
        }

        futures.forEach { it.get(30, TimeUnit.SECONDS) }
    }

    fun testVariableVariantsDoNotLeakIntoCachedResolution() {
        val file = myFixture.configureByText(
            "CachedVariable.fsh",
            "void main() { vec4 color = vec4(0.); float copy = color.r; }",
        )
        val member = PsiTreeUtil.findChildrenOfType(file, GlslVariable::class.java)
            .first { it.name == "r" }
        val reference = member.reference as GlslVariableReference

        assertEquals("r", reference.resolve()?.name)
        assertContainsElements(reference.variants.map { it.lookupString }, "r", "rgba")
        assertEquals(listOf("r"), reference.resolveMany().map { it.name })
    }

    fun testTypeVariantsDoNotLeakIntoCachedResolution() {
        val file = myFixture.configureByText(
            "CachedType.fsh",
            "struct Thing { float x; }; struct Tango { float x; }; void main() { T value; }",
        )
        val type = PsiTreeUtil.findChildrenOfType(file, GlslType::class.java)
            .first { it.name == "T" }
        val reference = type.reference as GlslTypeReference

        assertNull(reference.resolve())
        reference.doResolve(CONTAINS)
        assertContainsElements(reference.resolvedReferences.map { it.name }, "Thing", "Tango")
        assertEmpty(reference.resolveMany())
    }
}
