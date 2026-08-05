import com.intellij.codeInsight.documentation.DocumentationManager
import com.intellij.openapi.actionSystem.IdeActions
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import glsl.plugin.editor.GlslDocumentationProvider
import glsl.psi.interfaces.GlslFunctionCall
import glsl.psi.interfaces.GlslSingleDeclaration
import glsl.psi.interfaces.GlslUnaryExpr
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.util.PropertyResourceBundle

class GlslDocumentationTest : BasePlatformTestCase() {

    override fun getTestDataPath(): String {
        return "src/test/testData/documentation"
    }

    fun testDocumentationFile1() {
        myFixture.configureByFile("DocumentationFile1.glsl")
        val originalElement = myFixture.elementAtCaret as GlslSingleDeclaration
        val glslPostfixExpr = originalElement.exprNoAssignmentList.first() as GlslUnaryExpr
        val variableIdentifier = (glslPostfixExpr.postfixExpr as GlslFunctionCall).variableIdentifier
        val element = DocumentationManager
            .getInstance(project)
            .findTargetElement(myFixture.editor, variableIdentifier?.containingFile, variableIdentifier)
        val documentationProvider = DocumentationManager.getProviderFromElement(element)
        val doc = documentationProvider.generateDoc(element, originalElement)
        assertNotNull(doc)
        assertTrue(doc!!.contains("<div id=\"abs\">"))
    }

    fun testChineseDocumentationKeepsFunctionIdentifiers() {
        val provider = GlslDocumentationProvider()
        val doc = provider.getDocumentation(
            "fract",
            "builtin-objects/builtin-funcs-docs_zh_CN.html",
        )

        assertNotNull(doc)
        assertTrue(doc!!.contains("<div id=\"fract\">"))
        assertTrue(doc.contains("<h2>名称</h2>"))
        assertTrue(doc.contains("genType fract(genType x);"))
        assertTrue(doc.contains("计算参数的小数部分"))
    }

    fun testLocalizedBundlesHaveMatchingKeys() {
        val classLoader = GlslDocumentationTest::class.java.classLoader
        val english = classLoader.getResourceAsStream("messages/GlslBundle.properties")!!.use {
            PropertyResourceBundle(it.reader(StandardCharsets.UTF_8))
        }
        val chinese = classLoader.getResourceAsStream("messages/GlslBundle_zh_CN.properties")!!.use {
            PropertyResourceBundle(it.reader(StandardCharsets.UTF_8))
        }

        assertSameElements(english.keySet(), chinese.keySet())
        assertEquals(
            "builtin-objects/builtin-funcs-docs_zh_CN.html",
            chinese.getString("documentation.builtin.resource"),
        )
        assertTrue(Locale.SIMPLIFIED_CHINESE.language == "zh")
        assertTrue(chinese.getString("error.incompatible.types.in.init").contains("类型不兼容"))
    }

    fun testChineseDocumentationPreservesMathExpressions() {
        val provider = GlslDocumentationProvider()
        val resource = "builtin-objects/builtin-funcs-docs_zh_CN.html"
        val acos = provider.getDocumentation("acos", resource)!!
        val uaddCarry = provider.getDocumentation("uaddCarry", resource)!!

        assertTrue(acos.contains("\\left| x \\right| &gt; 1"))
        assertFalse(acos.contains("\\右"))
        assertTrue(uaddCarry.contains("<mml:mn>2</mml:mn><mml:mn>32</mml:mn>"))
        assertFalse(uaddCarry.contains("232"))
    }

    fun testUserFunctionDocumentation() {
        val file = myFixture.configureByFile("DocumentationFile2.glsl")
        val caretOffset = myFixture.editor.caretModel.offset
        val contextElement = file.findElementAt(caretOffset)
        val provider = GlslDocumentationProvider()
        val element = provider.getCustomDocumentationElement(
            myFixture.editor,
            file,
            contextElement,
            caretOffset,
        )
        val doc = provider.generateDoc(element, contextElement)
        assertNotNull(doc)
        assertTrue(doc!!.contains("int func()"))
        assertTrue(doc.contains("Function documentation"))
    }

    fun testUserFunctionDocumentationAtDeclaration() {
        val file = myFixture.configureByText(
            "DocumentationDeclaration.glsl",
            "/** Declaration documentation. */\nint fu<caret>nc() {}",
        )
        val caretOffset = myFixture.editor.caretModel.offset
        val contextElement = file.findElementAt(caretOffset)
        val provider = GlslDocumentationProvider()

        val element = provider.getCustomDocumentationElement(
            myFixture.editor,
            file,
            contextElement,
            caretOffset,
        )
        val doc = provider.generateDoc(element, contextElement)

        assertNotNull(doc)
        assertTrue(doc!!.contains("Declaration documentation."))
    }

    fun testDocumentationCommentIsClosedOnEnter() {
        myFixture.configureByText(
            "DocumentationEnter.glsl",
            "void main() {\n    /**<caret>\n}",
        )
        myFixture.performEditorAction(IdeActions.ACTION_EDITOR_ENTER)

        myFixture.checkResult("void main() {\n    /**\n     * <caret>\n     */\n}")
    }

    fun testDocumentationCommentLineContinuesOnEnter() {
        myFixture.configureByText(
            "DocumentationEnter.glsl",
            "void main() {\n    /**\n     * First line<caret>\n     */\n}",
        )
        myFixture.performEditorAction(IdeActions.ACTION_EDITOR_ENTER)

        myFixture.checkResult("void main() {\n    /**\n     * First line\n     * <caret>\n     */\n}")
    }

    fun testDocumentationCommentUsesExistingClosingDelimiter() {
        myFixture.configureByText(
            "DocumentationEnter.glsl",
            "void main() {\n    /**<caret>*/\n}",
        )
        myFixture.performEditorAction(IdeActions.ACTION_EDITOR_ENTER)

        myFixture.checkResult("void main() {\n    /**\n     * <caret>\n     */\n}")
    }
}
