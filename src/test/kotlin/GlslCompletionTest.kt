import com.intellij.codeInsight.completion.CompletionType
import com.intellij.codeInsight.lookup.Lookup
import com.intellij.codeInsight.lookup.LookupElementPresentation
import com.intellij.icons.AllIcons
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class GlslCompletionTest : BasePlatformTestCase() {

    override fun getTestDataPath(): String {
        return "src/test/testData/completion"
    }

    fun testCompletion1() {
        myFixture.configureByFiles("CompletionFile1.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        assertEquals(lookupElementStrings?.size, 12)
        assertContainsElements(lookupElementStrings!!, listOf("abs(float x)"))
    }

    fun testCompletion2() {
        myFixture.configureByFiles("CompletionFile2.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        assertNotNull(lookupElementStrings)
        assertContainsElements(lookupElementStrings!!, "max(int x, int y)")
    }

    fun testCompletion3() {
        myFixture.configureByFiles("CompletionFile3.geom")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        assertNotNull(lookupElementStrings)
        assertContainsElements(lookupElementStrings!!, "EmitVertex()")
    }

    fun testCompletion4() {
        myFixture.configureByFiles("CompletionFile4.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        assertNotNull(lookupElementStrings)
        assertContainsElements(lookupElementStrings!!, "while")
    }

    fun testCompletion5() {
        myFixture.configureByFiles("CompletionFile5.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        assertNotNull(lookupElementStrings)
        assertContainsElements(lookupElementStrings!!, "switch")
    }

    fun testCompletion6() {
        myFixture.configureByFiles("CompletionFile6.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        assertNotNull(lookupElementStrings)
        assertDoesntContain(lookupElementStrings!!, "switch")
    }

    fun testCompletion7() {
        myFixture.configureByFiles("CompletionFile7.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        assertNotNull(lookupElementStrings)
        assertDoesntContain(lookupElementStrings!!, "while")
    }

    fun testCompletion8() {
        myFixture.configureByFiles("CompletionFile8.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        assertNotNull(lookupElementStrings)
        assertContainsElements(lookupElementStrings!!, "define")
    }

    fun testCompletion9() {
        myFixture.configureByFiles("CompletionFile9.glsl")
        myFixture.complete(CompletionType.BASIC)

        assertEquals("#version 330\nint main() {\n    int a = 1;\n    int a = 2;\n}", myFixture.file.text)
    }

    fun testVersionCompletionUsesExactNumberPrefix() {
        myFixture.configureByText("VersionCompletion.glsl", "#version 330<caret> core")
        myFixture.complete(CompletionType.BASIC)

        assertEquals("#version 330 core", myFixture.file.text)
        myFixture.lookupElementStrings?.let { assertSameElements(it.toList(), "330") }
    }

    fun testVersionCompletionDoesNotTriggerAfterVersionNumber() {
        myFixture.configureByText("VersionCompletion.glsl", "#version 330 <caret>core")
        myFixture.complete(CompletionType.BASIC)

        assertEquals("#version 330 core", myFixture.file.text)
        assertNullOrEmpty(myFixture.lookupElementStrings)
    }

    fun testCompletion10() {
        myFixture.configureByFiles("CompletionFile10.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        val expectedComponents = listOf("x", "y", "r", "g", "s", "t")
        assertNotNull(lookupElementStrings)
        assertContainsElements(lookupElementStrings!!.toList(), expectedComponents)
    }

    fun testCompletion11() {
        myFixture.configureByFiles("CompletionFile11.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        val expectedComponents = listOf("b", "g", "r", "rb", "rg", "rgr", "s", "st", "t", "xy", "yz", "z")
        assertNotNull(lookupElementStrings)
        assertContainsElements(lookupElementStrings!!.toList(), expectedComponents)
    }

    fun testCompletion12() {
        myFixture.configureByFiles("CompletionFile12.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        val expectedComponents = listOf("bb", "arbg", "arbr", "arg", "bggr", "argb", "argg", "gb", "arr", "arra", "arrb")
        assertNotNull(lookupElementStrings)
        assertContainsElements(lookupElementStrings!!, expectedComponents)
    }

    fun testCompletion13() {
        myFixture.configureByFiles("CompletionFile13.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        val expectedTypeQualifiers = listOf("in", "inout", "invariant", "subroutine")
        assertNotNull(lookupElementStrings)
        assertContainsElements(lookupElementStrings!!, expectedTypeQualifiers)
    }

    fun testCompletion14() {
        myFixture.configureByFiles("CompletionFile14.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        val expectedTypes = listOf("float", "float16_t", "float32_t", "float64_t")
        assertNotNull(lookupElementStrings)
        assertSameElements(lookupElementStrings!!, expectedTypes)
    }

    fun testCompletion15() {
        myFixture.configureByFiles("CompletionFile15.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        assertNullOrEmpty(lookupElementStrings)
    }

    fun testCompletion16() {
        myFixture.configureByFiles("CompletionFile16.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        val typeQualifiers = listOf("in", "inout", "invariant", "subroutine")
        assertNotNull(lookupElementStrings)
        assertDoesntContain(lookupElementStrings!!, typeQualifiers)
    }

    fun testCompletion17() {
        myFixture.configureByFiles("CompletionFile17.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        assertNotNull(lookupElementStrings)
        assertContainsElements(lookupElementStrings!!, "int", "i8vec4", "inout", "invariant")
    }

    fun testCompletion18() {
        myFixture.configureByFiles("CompletionFile18.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        val expectedTypeQualifiers = listOf("in", "inout", "invariant", "subroutine")
        assertNotNull(lookupElementStrings)
        assertContainsElements(lookupElementStrings!!, expectedTypeQualifiers)
    }

    fun testCompletion19() {
        myFixture.configureByFiles("CompletionFile19.comp")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        assertNotNull(lookupElementStrings)
        assertContainsElements(lookupElementStrings!!, "gl_MaxAtomicCounterBindings", "gl_MaxAtomicCounterBufferSize", "gl_MaxComputeWorkGroupSize")
    }

    fun testCompletion20() {
        myFixture.configureByFiles("CompletionFile20.comp")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        val expectedComponents = listOf("b", "g", "r", "rb", "rg", "rgr", "s", "st", "t", "xy", "yz", "z")
        assertNotNull(lookupElementStrings)
        assertContainsElements(lookupElementStrings!!.toList(), expectedComponents)
    }

    fun testCompletion21() {
        myFixture.configureByFiles("CompletionFile21.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        val expectedComponents = listOf("b", "g", "r", "rb", "rg", "rgr", "s", "st", "t", "xy", "yz", "z")
        assertNotNull(lookupElementStrings)
        assertContainsElements(lookupElementStrings!!.toList(), expectedComponents)
    }

    fun testCompletion22() {
        myFixture.configureByFiles("CompletionFile22.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        val expectedComponents = listOf("vec")
        assertNotNull(lookupElementStrings)
        assertSameElements(lookupElementStrings!!.toList(), expectedComponents)
    }

    fun testCompletion23() {
        myFixture.configureByFiles("CompletionFile23.glsl")
        myFixture.complete(CompletionType.BASIC)
        val lookupElementStrings = myFixture.lookupElementStrings
        assertEquals(0, lookupElementStrings?.size)
    }

    fun testCompletion24() {
        myFixture.configureByFiles("CompletionFile24a.glsl", "include-test/include-test2/CompletionFile24b.glsl", "include-test/include-test3/CompletionFile24c.glsl")
        myFixture.complete(CompletionType.BASIC)
        val expectedComponents = listOf("include-test/")
        val lookupElementStrings = myFixture.lookupElementStrings
        assertEquals(1, lookupElementStrings?.size)
        assertSameElements(lookupElementStrings!!.toList(), expectedComponents)
    }

    fun testLayoutQualifierCompletion() {
        myFixture.configureByText("LayoutCompletion.vert", "lay<caret>")
        myFixture.complete(CompletionType.BASIC)

        val lookupStrings = myFixture.lookupElementStrings
        if (lookupStrings == null) {
            assertEquals("layout", myFixture.file.text)
        } else {
            assertContainsElements(lookupStrings, "layout")
        }
    }

    fun testLayoutIdentifierCompletion() {
        myFixture.configureByText("LayoutIdentifierCompletion.vert", "layout(loc<caret>) in vec3 pos;")
        myFixture.complete(CompletionType.BASIC)

        assertContainsElements(myFixture.lookupElementStrings!!, "location")
    }

    fun testQualifierCompletionAfterLayout() {
        myFixture.configureByText("PostLayoutCompletion.vert", "layout(location = 0) i<caret> vec3 pos;")
        myFixture.complete(CompletionType.BASIC)

        assertContainsElements(myFixture.lookupElementStrings!!, "in", "inout")
    }

    fun testBuiltinTypesUseTypeIcon() {
        myFixture.configureByText("TypeIconCompletion.glsl", "void main() { ve<caret> value; }")
        myFixture.complete(CompletionType.BASIC)

        val vec3 = myFixture.lookupElements!!.first { it.lookupString == "vec3" }
        val presentation = LookupElementPresentation()
        vec3.renderElement(presentation)
        assertSame(AllIcons.Nodes.Type, presentation.icon)
    }

    fun testConstructorSwizzleCompletion() {
        myFixture.configureByText("ConstructorSwizzleCompletion.fsh", "void main() { vec4 color = vec4(0.).<caret>; }")
        myFixture.complete(CompletionType.BASIC)

        assertContainsElements(myFixture.lookupElementStrings!!, "argb", "rgba", "xyzw")
    }

    fun testVectorComponentDoesNotOfferSwizzles() {
        myFixture.configureByText("VectorComponent.fsh", "void main() { float value = vec4(0.)[0].<caret>; }")
        myFixture.complete(CompletionType.BASIC)

        assertNullOrEmpty(myFixture.lookupElementStrings)
    }

    fun testArrayElementOffersVectorSwizzles() {
        myFixture.configureByText(
            "ArrayElement.fsh",
            "void main() { vec4 values[2]; vec4 value = values[0].<caret>; }",
        )
        myFixture.complete(CompletionType.BASIC)

        assertContainsElements(myFixture.lookupElementStrings!!, "rgba", "xyzw")
    }

    fun testMatrixColumnOffersVectorSwizzles() {
        myFixture.configureByText("MatrixColumn.fsh", "void main() { vec3 value = mat3(1.)[0].<caret>; }")
        myFixture.complete(CompletionType.BASIC)

        assertContainsElements(myFixture.lookupElementStrings!!, "rgb", "xyz")
    }

    fun testConstructorCompletionInsertionContext() {
        myFixture.configureByText("ConstructorContext.glsl", "void main() { ve<caret> }")
        myFixture.complete(CompletionType.BASIC)
        myFixture.finishLookup(Lookup.NORMAL_SELECT_CHAR)
        assertEquals("void main() { vec2 }", myFixture.file.text)

        myFixture.configureByText("ConstructorContext.glsl", "void main() { ve<caret> value; }")
        myFixture.complete(CompletionType.BASIC)
        myFixture.finishLookup(Lookup.NORMAL_SELECT_CHAR)
        assertEquals("void main() { vec2 value; }", myFixture.file.text)

        myFixture.configureByText(
            "ConstructorContext.glsl",
            "void main() { ve<caret> /* type */ value; }",
        )
        myFixture.complete(CompletionType.BASIC)
        myFixture.finishLookup(Lookup.NORMAL_SELECT_CHAR)
        assertEquals("void main() { vec2 /* type */ value; }", myFixture.file.text)

        myFixture.configureByText(
            "ConstructorContext.glsl",
            "void main() { vec3 vector; ve<caret> = vec3(0.); }",
        )
        myFixture.complete(CompletionType.BASIC)
        myFixture.finishLookup(Lookup.NORMAL_SELECT_CHAR)
        assertEquals("void main() { vec3 vector; vector = vec3(0.); }", myFixture.file.text)

        myFixture.configureByText("ConstructorContext.glsl", "void doSth(ve<caret>) {}")
        myFixture.complete(CompletionType.BASIC)
        myFixture.finishLookup(Lookup.NORMAL_SELECT_CHAR)
        assertEquals("void doSth(vec2) {}", myFixture.file.text)

        myFixture.configureByText("ConstructorContext.glsl", "void main() { vec3 value = ve<caret>; }")
        myFixture.complete(CompletionType.BASIC)
        myFixture.finishLookup(Lookup.NORMAL_SELECT_CHAR)
        assertEquals("void main() { vec3 value = vec3(); }", myFixture.file.text)

        myFixture.configureByText(
            "ConstructorContext.glsl",
            "void doSth(vec3 v) {} void main() { doSth(ve<caret>); }",
        )
        myFixture.complete(CompletionType.BASIC)
        myFixture.finishLookup(Lookup.NORMAL_SELECT_CHAR)
        assertEquals("void doSth(vec3 v) {} void main() { doSth(vec2()); }", myFixture.file.text)
    }

    fun testSameTypeVariableIsPreferredOverConstructor() {
        myFixture.configureByText(
            "VariablePriority.glsl",
            "void main() { vec3 vector; vec3 value = v<caret>; }",
        )
        myFixture.complete(CompletionType.BASIC)

        assertEquals("vector", myFixture.lookupElementStrings?.firstOrNull())
    }

    fun testExpectedTypeConstructorIsPreferredWithoutMatchingVariable() {
        myFixture.configureByText(
            "ConstructorPriority.glsl",
            "void main() { vec3 value = v<caret>; }",
        )
        myFixture.complete(CompletionType.BASIC)

        assertEquals("vec3", myFixture.lookupElementStrings?.firstOrNull())
    }

    fun testVariableIsPreferredOverConstructorInFunctionArgument() {
        myFixture.configureByText(
            "FunctionArgumentPriority.glsl",
            "void use(vec3 value) {} void main() { vec3 vector; use(v<caret>); }",
        )
        myFixture.complete(CompletionType.BASIC)

        assertEquals("vector", myFixture.lookupElementStrings?.firstOrNull())
    }

    fun testNestedCallDoesNotInheritDeclarationType() {
        myFixture.configureByText(
            "NestedCallPriority.glsl",
            "void main() { vec3 vector; float scalar = dot(v<caret>, vector); }",
        )
        myFixture.complete(CompletionType.BASIC)

        assertEquals("vector", myFixture.lookupElementStrings?.firstOrNull())
    }

    fun testCustomFunctionOverloadsCompletion() {
        myFixture.configureByText(
            "CustomFunctionOverloads.glsl",
            """
                float saturate(float value) { return value; }
                vec3 saturate(vec3 value) { return value; }
                void main() { sa<caret> }
            """.trimIndent(),
        )
        myFixture.complete(CompletionType.BASIC)

        val overloads = myFixture.lookupElements
            ?.filter { it.lookupString.startsWith("saturate(") }
            .orEmpty()
        assertSameElements(
            overloads.map { it.lookupString },
            "saturate(float value)",
            "saturate(vec3 value)",
        )

        val presentations = overloads.map { lookupElement ->
            LookupElementPresentation().also(lookupElement::renderElement)
        }
        presentations.forEach { assertSame(AllIcons.Nodes.Function, it.icon) }
        assertSameElements(presentations.map { it.typeText }, "float", "vec3")
    }

    fun testCustomFunctionCompletionBeforeFollowingStatement() {
        myFixture.configureByText(
            "CustomFunctionBeforeStatement.glsl",
            """
                void useVector(vec3 value) {}
                void useVector(vec4 value) {}
                void main() {
                    vec3 vector = vec3(0.);
                    use<caret>
                    useVector(vector);
                }
            """.trimIndent(),
        )
        myFixture.complete(CompletionType.BASIC)

        assertContainsElements(
            myFixture.lookupElementStrings!!,
            "useVector(vec3 value)",
            "useVector(vec4 value)",
        )
    }

    fun testSingleCustomFunctionCompletionBeforeFollowingStatement() {
        myFixture.configureByText(
            "SingleCustomFunctionBeforeStatement.glsl",
            """
                void useVector(vec3 value) {}
                void main() {
                    vec3 vector = vec3(0.);
                    use<caret>
                    useVector(vector);
                }
            """.trimIndent(),
        )
        myFixture.complete(CompletionType.BASIC)

        assertEquals(
            """
                void useVector(vec3 value) {}
                void main() {
                    vec3 vector = vec3(0.);
                    useVector()
                    useVector(vector);
                }
            """.trimIndent(),
            myFixture.file.text,
        )
    }

    fun testStandaloneIdentifierRecoveryDoesNotAffectMultilineArguments() {
        myFixture.configureByText(
            "MultilineFunctionArgument.glsl",
            """
                void useVector(vec3 value) {}
                void main() {
                    useVector(
                        ve<caret>
                    );
                }
            """.trimIndent(),
        )
        myFixture.complete(CompletionType.BASIC)

        assertContainsElements(myFixture.lookupElementStrings!!, "vec3")
    }

    fun testCustomFunctionCompletionBeforeCommentedStatement() {
        myFixture.configureByText(
            "CustomFunctionBeforeComment.glsl",
            """
                void useVector(vec3 value) {}
                void useVector(vec4 value) {}
                void main() {
                    use<caret>
                    /* keep this statement separate */
                    useVector(vec3(0.));
                }
            """.trimIndent(),
        )
        myFixture.complete(CompletionType.BASIC)

        assertContainsElements(
            myFixture.lookupElementStrings!!,
            "useVector(vec3 value)",
            "useVector(vec4 value)",
        )
    }

    fun testBuiltinFunctionOverloadsAreNotDuplicated() {
        myFixture.configureByText("BuiltinFunctionDuplicates.glsl", "void main() { sin<caret> }")
        myFixture.complete(CompletionType.BASIC)

        val overloads = myFixture.lookupElementStrings
            ?.filter { it.startsWith("sin(") }
            .orEmpty()
        assertNotEmpty(overloads)
        assertEquals(overloads.distinct().size, overloads.size)
    }
}
