using System.Text;
using System.Text.Json;

namespace DataGarden;

/// <summary>
/// Data Garden — a warm, physics-driven 3D garden of live crypto prices,
/// rendered in a WebView2-hosted Three.js scene.
/// </summary>
public static class Program
{
    [STAThread]
    public static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new GardenForm());
    }
}

public class GardenForm : Form
{
    private Microsoft.Web.WebView2.WinForms.WebView2 _web = null!;
    private HttpClient _http = null!;
    private CancellationTokenSource _cts = new();

    // Tasteful warm palette: dark bark background, copper text.
    private const int BackColorDark = unchecked((int)0xFF231A14);   // warm near-black
    private const string ApiUrl =
        "https://api.binance.com/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22,%22ETHUSDT%22,%22SOLUSDT%22,%22DOGEUSDT%22,%22XRPUSDT%22,%22ADAUSDT%22%5D";

    public GardenForm()
    {
        Text = "Data Garden";
        MinimumSize = new Size(1100, 700);
        Size = new Size(1280, 800);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(BackColorDark);
        // Borderless-friendly: still resizable, minimal chrome handled by the user via title bar.
        // (Kept a normal border for practicality; the dark palette keeps it unobtrusive.)

        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        _http.DefaultRequestHeaders.Add("User-Agent", "DataGarden/1.0");

        InitWebViewAsync();
        Task.Run(() => PollLoopAsync(_cts.Token));
    }

    private async void InitWebViewAsync()
    {
        _web = new Microsoft.Web.WebView2.WinForms.WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.FromArgb(BackColorDark)
        };
        Controls.Add(_web);

        // userData folder next to exe so it works from any install location
        var userData = Path.Combine(AppContext.BaseDirectory, "webview-data");
        await _web.EnsureCoreWebView2Async();
        

        // Map virtual host app.local -> www folder; avoids file:// CORS issues
        var wwwRoot = Path.Combine(AppContext.BaseDirectory, "www");
        if (!Directory.Exists(wwwRoot)) wwwRoot = Path.Combine(Environment.CurrentDirectory, "www");
        _web.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "app.local", wwwRoot,
            Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind.Allow);

        _web.CoreWebView2.Settings.AreDevToolsEnabled = false;
        _web.CoreWebView2.Navigate("https://app.local/index.html");
    }

    /// <summary>
    /// Polls Binance every ~12 seconds, forwards the JSON into the 3D scene via
    /// window.updateData(...). On failure keeps last data and tells the HUD.
    /// </summary>
    private async Task PollLoopAsync(CancellationToken ct)
    {
        var jitter = new Random();
        while (!ct.IsCancellationRequested)
        {
            bool ok = false;
            string? payload = null;
            try
            {
                var json = await _http.GetStringAsync(ApiUrl, ct);
                // Validate it parses before shipping it to the page
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.ValueKind == JsonValueKind.Array)
                {
                    payload = json;
                    ok = true;
                }
            }
            catch (Exception)
            {
                // rate limit / network hiccup — keep last data
            }

            if (payload != null)
                await PushAsync($"window.updateData({payload});");
            await PushAsync(ok
                ? "window.updateStatus({ok:true});"
                : "window.updateStatus({ok:false});");

            // 12s base + jitter to avoid tight rhythm
            try { await Task.Delay(TimeSpan.FromSeconds(12 + jitter.Next(0, 4)), ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>
    /// ExecuteScriptAsync has thread affinity to the UI thread - marshal there.
    /// Called from the background poll loop; without this every push throws
    /// cross-thread and is silently swallowed, leaving the HUD on "connecting".
    /// </summary>
    private Task PushAsync(string script)
    {
        try
        {
            if (_web?.CoreWebView2 == null || IsDisposed) return Task.CompletedTask;
            // BeginInvoke marshals onto the UI thread (WebView2 thread affinity)
            BeginInvoke(() =>
            {
                try { if (!IsDisposed) _ = _web.CoreWebView2.ExecuteScriptAsync(script); }
                catch { /* webview gone */ }
            });
            return Task.CompletedTask;
        }
        catch (ObjectDisposedException) { return Task.CompletedTask; }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        _cts.Cancel();
        base.OnFormClosing(e);
    }
}