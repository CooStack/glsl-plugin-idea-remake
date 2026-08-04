package glsl.plugin.reference

import com.intellij.codeInsight.lookup.LookupElement
import com.intellij.openapi.util.TextRange
import com.intellij.psi.impl.source.resolve.ResolveCache
import com.intellij.psi.impl.source.resolve.ResolveCache.AbstractResolver
import com.intellij.psi.util.PsiTreeUtil.getParentOfType
import com.intellij.psi.util.PsiTreeUtil.getPrevSiblingOfType
import glsl.plugin.psi.GlslType
import glsl.plugin.psi.named.GlslNamedElement
import glsl.plugin.psi.named.GlslNamedType
import glsl.plugin.reference.FilterType.CONTAINS
import glsl.psi.interfaces.GlslDeclaration
import glsl.psi.interfaces.GlslExternalDeclaration
import glsl.psi.interfaces.GlslStatement

class GlslTypeReference(private val element: GlslType, textRange: TextRange) : GlslReference(element, textRange) {

    private val resolver = AbstractResolver<GlslTypeReference, GlslNamedType> { reference, _ ->
        synchronized(reference) {
            reference.doResolve()
            reference.resolvedReferences.firstOrNull() as? GlslNamedType
        }
    }

    /**
     *
     */
    override fun resolve(): GlslNamedType? {
        return synchronized(this) {
            if (!shouldResolve()) return@synchronized null
            val resolveCache = ResolveCache.getInstance(project)
            resolveCache.resolveWithCaching(this, resolver, true, false)
        }
    }

    /**
     *
     */
    override fun getVariants(): Array<LookupElement> {
        return synchronized(this) {
            doResolve(CONTAINS)
            resolvedReferences.mapNotNull { it.getLookupElement() }.toTypedArray()
        }
    }

    /**
     *
     */
    override fun doResolve(filterType: FilterType) {
        synchronized(this) {
            try {
                resolvedReferences.clear()
                includeFiles.clear()
                currentFilterType = filterType
                resolveType()
            } catch (_: StopLookupException) {
                // A matching reference deliberately stops the remaining scope walk.
            } finally {
                includeFiles.clear()
            }
        }
    }

    /**
     *
     */
    override fun shouldResolve(): Boolean {
        if (currentFilterType == CONTAINS && element.isEmpty()) return true
        return element.getDeclaration() == null
    }

    /**
     *
     */
    override fun resolveMany(): List<GlslNamedElement> {
        return synchronized(this) {
            if (!shouldResolve()) return@synchronized emptyList()
            doResolve()
            resolvedReferences.toList()
        }
    }

    /**
     *
     */
    private fun resolveType(): GlslNamedType? {
        var statementPrevSibling = getParentOfType(element, GlslStatement::class.java)
        while (statementPrevSibling != null) {
            resolveDeclarationType(statementPrevSibling.declaration)
            statementPrevSibling = getPrevSiblingOfType(statementPrevSibling, GlslStatement::class.java)
        }
        var externalDeclaration = getParentOfType(element, GlslExternalDeclaration::class.java)
        while (externalDeclaration != null) {
            externalDeclaration = getPrevSiblingOfType(externalDeclaration, GlslExternalDeclaration::class.java)
            lookupInExternalDeclaration(externalDeclaration)
        }
        return null
    }

    /**
     *
     */
    override fun lookupInExternalDeclaration(externalDeclaration: GlslExternalDeclaration?) {
        lookupInIncludeDeclaration(externalDeclaration?.ppStatement?.ppIncludeDeclaration)
        resolveDeclarationType(externalDeclaration?.declaration)
    }

    /**
     *
     */
    private fun resolveDeclarationType(declaration: GlslDeclaration?) {
        if (declaration == null) return
        val structSpecifier = declaration.singleDeclaration?.typeSpecifier?.structSpecifier
        if (structSpecifier != null) {
            findReferenceInElement(structSpecifier)
        } else if (declaration.blockStructureWrapper != null) {
            findReferenceInElement(declaration.blockStructureWrapper?.blockStructure)
        }
    }
}
