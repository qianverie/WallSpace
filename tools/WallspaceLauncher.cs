using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class WallspaceLauncher
{
    [STAThread]
    private static void Main()
    {
        try
        {
            string runtime = AppDomain.CurrentDomain.BaseDirectory;
            string root = Directory.GetParent(runtime.TrimEnd(Path.DirectorySeparatorChar)).FullName;
            var start = new ProcessStartInfo(Path.Combine(runtime, "electron.exe"), "\"" + root + "\"");
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            start.EnvironmentVariables.Remove("NODE_OPTIONS");
            using (Process.Start(start)) { }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Wallspace", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
