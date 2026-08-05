# GLSL Plugin Changelog

## [1.1.17]
### Fixed
- Retry the initial JCEF visibility sync after the tool window is attached so time-based previews do not remain paused until the window is moved.
- Keep the animation loop active when a compiled shader source consumes a configured `tick` or `time` alias, even if the driver optimizes the uniform reflection differently.

## [1.1.16]
### Fixed
- Stop continuously redrawing static shaders that do not consume `tick`, `time`, or Ping-Pong state.
- Pause WebGL rendering while dragging, panning, zooming, wiring, or resizing the graph, then render the latest frame when interaction ends.
- Reuse graph connection elements while nodes move instead of rebuilding every line on each animation frame.

## [1.1.15]
### Added
- Add a divider button that collapses and restores the scene or graph panel without losing its resized width.

## [1.1.14]
### Fixed
- Raise the JCEF off-screen rendering limit to 60 FPS so the visible preview is not capped by the browser host after its animation loop has been uncapped.

## [1.1.13]
### Changed
- Render at the browser's native `requestAnimationFrame` rate while the preview tool window is visible.

### Fixed
- Stop the preview animation loop when the tool window is hidden and resume it when the window is reopened.

## [1.1.12]
### Added
- Use separate model-render and post-processing graph canvases, each with its own layout, pan, and zoom state.
- Create shader, texture, and Ping-Pong nodes from the context menu of the active graph.
- Create empty texture nodes first, then bind or replace their images by dropping files from the IDE onto the card.
- Allow scalar and vector parameters to use numeric constants or live `tick`, `time`, resolution, camera, and Ping-Pong variables.
- Add model and post-processing vertex-shader settings, reflected vertex inputs and uniforms, editable matrix sources, UV semantics, and global `tick` / `time` aliases.
- Warn when a vertex shader's outputs do not match a fragment shader's inputs by location, name, type, or array length.

### Fixed
- Bind common custom vertex-shader matrix names such as `projMat`, `viewMat`, and `transMat`, and recognize `pos` as a position attribute.
- Generate UVs for built-in geometry and OBJ files without texture coordinates.
- Keep mesh index buffers isolated when custom post-processing vertex shaders create their screen geometry, and reload those shaders during recompilation.
- Make global `tick` and `time` aliases replaceable without leaving removed built-in names hidden or stuck at zero.
- Treat conflicting engine aliases and incompatible alias types as ordinary uniforms, and report unsupported integer, matrix, or array vertex inputs before rendering.
- Coalesce graph drag and zoom updates, cache uniform locations, reuse camera matrices, and throttle WebGL error checks.
- Close the graph context menu when the user clicks an empty area of either graph.
- Keep declared sampler ports visible when WebGL optimizes unused sampler uniforms out of the active program.

## [1.1.11]
### Added
- Recompile valid Graph changes automatically. After an automatic failure, keep the last working render and require one successful manual compile before automatic compilation resumes.
- Add configurable per-frame Ping-Pong write counts, plus editable iteration and phase uniform aliases. Phase `0` writes Ping and phase `1` writes Pong.
- Allow multiple texture nodes to share one imported texture resource.

### Fixed
- Preserve the active texture handles and Ping-Pong history when a candidate Graph fails to compile or render.
- Prevent stale image decoding requests from replacing a newer import of the same texture.
- Support single-pass Ping-Pong feedback without blitting from the default framebuffer.
- Place newly created texture and Ping-Pong nodes without covering existing cards.
- Allow Graph links to start from either socket and keep active drags intact while automatic compilation refreshes the Graph.
- Keep an offscreen target for an intermediate output pass when later passes still read from it.
- Keep custom Graph node positions when a fragment pass is removed.
- Accept vertex and fragment shader file drops directly on their Graph cards.

## [1.1.10]
### Added
- Add draggable shader graph nodes, left-button panning, zoom controls, and a resizable preview panel.
- Add editable model and final output connections, independent texture nodes with explicit wiring, and direct IDE file drag-and-drop.
- Group uniform values by fragment pass and allow per-pass aliases such as `iFrame` and `iTime` for `tick` and `time`.

### Changed
- Remove compute shader configuration from the preview because WebGL2 cannot execute compute shaders.

### Fixed
- Draw graph links from socket center to socket center and keep wiring active outside the graph canvas.
- Use a black 1 x 1 texture for unbound `sampler2D` inputs and retry image uploads through decoded RGBA pixels when JCEF rejects the direct path.
- Correct the horizontal camera orbit direction when dragging with the middle mouse button.
- Read shader documents through an IntelliJ read action when requests originate from JCEF threads.
- Keep the last working render active after a failed recompile or framebuffer update.

## [1.1.9]
### Added
- Add a WebGL2 shader preview tool window with built-in and OBJ models, reflected uniforms, camera controls, `tick` and `time` inputs, and multi-pass framebuffer rendering.
- Add Simplified Chinese labels, status messages, file dialogs, and diagnostics throughout the shader preview.

### Fixed
- Keep the last working preview when shader recompilation or rendering fails.
- Handle stale shader reads, legacy `gl_FragColor` conversion, and framebuffer allocation failures.

## [1.1.8]
### Added
- Complete `layout` declaration qualifiers and common OpenGL 4.6 layout identifiers.
- Distinct type icons for built-in type completion items.
- Simplified Chinese diagnostics, inspection names, and built-in function documentation selected from the IDE language.
- Diagnostics for invalid vector swizzles such as `vec3(0.).argb`.

### Fixed
- Prevent concurrent reference resolution from corrupting shared lookup results and throwing `ArrayIndexOutOfBoundsException`.
- Keep cached single-reference resolution independent from completion candidates.
- Complete vector swizzles after constructor expressions such as `vec4(0.).rgba`.
- Infer constructor swizzle result types so invalid assignments are reported on the correct expression without cascading to later statements.
- Validate swizzles by vector dimension, including extension vector types.
- Infer vector, matrix, and declared-array element types after indexing.
- Keep constructor parentheses out of declarations and assignment left-hand sides while code is incomplete.
- Rank local variables ahead of generic constructors in call arguments, while preserving expected-type ranking in initializers.

## [1.1.7]
### Added
- Support for the `GL_EXT_mesh_shader` storage qualifiers.

### Updated
- Target IntelliJ IDEA 2026.2.0.1.

### Fixed
- Provide a stable GLSL code style configurable ID on current JetBrains IDEs.
- Isolate built-in PSI caches by project to avoid references to disposed projects.

## [1.1.6]
### Updated
- IDE build version.

## [1.1.5]
### Fixed
- Iteration variable was resolved outside the iteration loop
- Fixed Dynamic type check
- Fixed broken swizzling for the stpq group
- Added compatibility profile uniforms
- Fixed nested builtin struct namespace pollution
### Added
- File structure view
- Improved highlighting for light themes.

## [1.1.4]
- Updated version

## [1.1.3]
### Added
- Enabling/disabling errors
### Update
- New builtin functions documentation with more information and nicer representation
- Small change in syntax colors for better distinction
### Fixed
- Array indexing of vector incorrectly showed an error
- Ambiguous imports

## [1.1.2]
### Added
- Autocompletion for include statement (not complete)
- Add more error annotations
### Updated
- Performance improvement in resolving builtin functions 
- Allowed macros at the end of file to not have new line 
### Fixed
- Formatting of macros didn't work correctly
- Macro functions without params were recognized as macro object
- Multiple assignment with commas didn't compile
- Error message was wrong when calling a struct constructor

## [1.1.1]
### Added
- Language injection to HTML script tag
### Updated
- Re-enabled #include support
### Fixed
- CRITICAL - lexer broke after renaming
- #ifdef directive lexing bug
- Macro define already exists threw an error
- Macro function call with param that are themselves macros threw an error
- Builtin shader variables coloring didn't work
- Live template of for loops didn't automatically

## [1.1.0]
### Updated
- Macro #define support changed completely and should work much better now.
### Deleted
- #include support didn't work well and was also very risky in case of recursive imports. 
Disabled for now. Next release should have a better support.

## [1.0.74]
### Updated
- IDE build version.

## [1.0.73]
### Updated
- IDE build version.

## [1.0.72]
### Updated
- IDE build version.
### Changed
- Disabled code annotation as there are many errors. 

## [1.0.71]
### Updated
- IDE build version.
### Fixed
- texture3D and textureCube could not be fetched.

## [1.0.7]
### Fixed
- Wrong type compatibility warning on array index assignment.
- Changed texture2D, texture3D and textureCube to functions instead of types.
### Added 
- Macros on preprocessors with if statements (__VERSION__, __LINE__...). 
- User defined colors to operators.
### Updated
- Syntax colors should have a stronger contrast.

## [1.0.6]
- Updated build version to 223.*
 
## [1.0.5]
### Added 
- Scalar constructor support (int, float, double, bool).
- More file extensions are supported: **vsh**, **gsh**, **fsh**.
### Fixed
- Support for angled brackets #include.
- Added missing imageStore and imageLoad builtin functions.
- Wrong error with struct constructors.

## [1.0.4]
Big release.
### Added
- Introducing code analysis. Starting with function arguments and declarations. It means that
when passing wrong types as arguments or declaring variables with the wrong type, an error should appear.
  <br>NOTE! this is still in beta version. If you encounter any bugs, you are more than welcome to report. 
- Introducing live templates. Starting with 'for'.
- Vectors should have now all possible components, including swizzling, e.g. vec2.xxyy;
- Support for #include files.
### Updated 
- Parser is now able to parse partial expressions without crashing (prior to that, it was only possible  
in declarations). It means that now, an expression like a = b + ..., will be recognized even if partial, which
also means that all feature like autocompletion will work in such cases.
- Builtin functions references and autocompletion should be more accurate now.
### Fixed
- Autocompletion was triggered also on digits.
- Multiple multiline comments had a weird behaviour. Should be fixed.
- Preprocessors could not be parsed inside struct declaration.
- Fixed assignment expression rules in grammar. Multiple assignment in one line could not be
  parsed correctly. Also fixed comma seperated expressions.

## [1.0.3] 
### Added
- Caching. Should improve performance.
- Autocompletion: 
  - Vectors and matrix constructors autocompletion.
  - More information on popup and a slightly better look.
- More reformatting.
- Resolution of builtin functions. This means that builtin functions will resolve to their corresponding type,
which also allows the resolution of the members of this type.
### Updated
- Visibility and scoping of block variables - should be now in accordance with the GLSL specification.
- Preprocessors. There was a silly attempt to try and parse macros as this requires much more logic. Hence, 
complicated-to-parse preprocessors are disabled, like #define, and you should only see plain text with minimal parsing (only lexing).
Disabling them reduces the chance for the whole parser to crash - so better no functionality than non-functional functionality.
### Fixed
- Backslashes in preprocessors are fixed.
- Floating point with exponent could not be parsed.
- Vector components resolution was in some cases incorrect.

## [1.0.2] 
### Added
- gl_in reference from geometry shader.
### Fixed
- Struct fields could be referenced without a dot qualification call.
- Formatting of semicolon shifted an extra space to the right.

## [1.0.1]
No important updates.

## [1.0.0]
### Added
- Macro define support for variable declaration and functions.
### Fixed
- References to builtin vectors didn't work well. Hopefully should be better now. 
- Global constants highlighting didn't pick the right color.  
- Parsing error of conditional expression. 

## [0.0.91]
### Added 
- More builtin variables - for all shaders and global constants, and more builtin funcs.
### Fixed
- Hotfix: #version with profile caused a parser error that couldn't recover.

## [0.9.9]
### Added 
- Create new shader file on the project menu.
- Improved reformatting.
- Introduced vector support - code completion and type check when calling components. For example 'v.xy'. 
### Fixed
- New line in some cases made a double indent.
- Incorrect parsing errors:
  - Array initializer with user defined type.
  - Return without an expression.
  - Redundant semicolons.

## [0.9.8]
### Added
- Better looking coloring for preprocessors and parsing of numbers and strings.
- Macro parsing.
- Improved text insert after choosing from code completion.
- Code completion:
  -  Should be slightly better now on where to suggest completions (but still very far from being good).
  -  Struct dot qualifier (vectors and matrices not yet supported).
  -  Preprocessors and more keywords.
  -  Versions after #version.

- ### Fixed
- Function parameters were referenced from outside their scopes 
- Struct constructor could not get referenced 

## [0.9.7]
### Added
- Commenter (make sure shortcut is activated)
- Missing highlighting for some keywords. 
### Fixed
- Declaration of variable with user defined type had a parsing error.

## [0.9.6]
### Added
- Layout variables coloring.
### Changed
- Conform with GLSL specification regarding numbers and identifiers in lexer.
### Removed
- Removed preprocessor handling altogether for now since it leads to parser error and doesn't let 
recovery so the rest of the file cannot get parsed, which leads in return to uselessness of the plugin. 
### Fixed
- Issues with one-line multi-declaration (with comma).
- Incorrect parsing of floating points and integer, like hexadecimal and unsigned.

## [0.9.5]
### Notes
- Very good release. It's getting there!
  Some changes may not be apparent but internally many improvements were taken place which improved
  the project's architecture and performance a lot. This will allow changes much more easily in the
  future, and in general, things are supposed to work much now better. Here are some of the changes.
### Added
- Parsing improvements - multiline declaration is now possible and bug fixes.
- Better structs handling.
- Documentation works now for user defined functions as well.
- References improvements.
- Introduced first testing for plugin.

### Removed
- Temporarily removed check of unused variables as it's still not robust and can annoy the user if an error appears but the variable is actually declared. For now, it does nothing.
            
## [0.9.4]
### Added
- Added code formatting

## [0.9.3]
### Added
- Improved completion

## [0.9.1]
### Added
- Bug fix

## [0.9.0]
### Added
- Introduced first testing for plugin.

## [0.8.3]
### Added
- Upgraded version

## [0.8.0]
### Added
- Implemented grammar recover 
- Bug fixes

## [0.7.1]
### Added
- Bug fixes

## [0.7.0]
### Added
- Variables checking
- Struct support
- (some) preprocessor support
- bug fixes
