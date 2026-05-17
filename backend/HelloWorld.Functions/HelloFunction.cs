using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;

namespace HelloWorld.Functions;

public class HelloFunction
{
    [Function("Hello")]
    public IActionResult Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "hello")] HttpRequest req)
    {
        req.HttpContext.Response.Headers.Append("Cache-Control", "no-store");
        return new OkObjectResult(new { message = "Hello, World!" });
    }
}
