[![Downloads](https://img.shields.io/jetbrains/plugin/d/18470-glsl)](https://plugins.jetbrains.com/plugin/18470-glsl/reviews)
[![Rating](https://img.shields.io/jetbrains/plugin/r/stars/18470-glsl)](https://plugins.jetbrains.com/plugin/18470-glsl/reviews)
### [Donation with PayPal](https://www.paypal.com/donate/?hosted_button_id=FVDM2Z3ESPC5Y)

# GLSL Plugin
GLSL plugin support for JetBrains IDE's.
Feel free to report any issue, problem, bug or add any request.

[Plugin Page](https://plugins.jetbrains.com/plugin/18470-glsl)


## Build & Run
``` shell
git clone https://github.com/walt-grace/glsl-plugin-idea.git
```
Assuming you're developing with Intellij (and you want to develop with Intellij):
1. **Generate grammar**. Execute the `generateGrammarClean` task from _gradle.build_ file or under _Tasks/other_ if you use the Gradle tab. 
2. **Run**. Execute the `runIde` task (Intellij will build the project and then run the instance).

\* If you're only interested in building the project without running it you can use task `buildPlugin` after step 1.

## Test
Just execute the `test` task from the Gradle tab or run specific classes or tests from within the ide.


## 须知
这个项目是基于原项目2025年的最新版 fork来的
所有的更改都是 gpt-5.6-sol 模型制作

fork此项目纯为了个人方便， 所以我没有做为新插件上传到jetbrains插件市场
如果有问题，你可以fork这个fork， 然后自己或者用AI修复， 也可以直接把修复好的内容合并到这个项目里

不过，因为所有的测试都是AI进行，我并没有参与， 我只参与了实际使用测试，所以并不保证会不会有什么安全问题
