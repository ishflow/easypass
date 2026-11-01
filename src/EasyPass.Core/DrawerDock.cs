using System.Globalization;

namespace EasyPass.Core;

public enum DockEdge { Right, Left, Top, Bottom }

public readonly record struct DockArea(double Left, double Top, double Right, double Bottom);

/// <summary>The window's box on the screen. Inside it, "along" runs on the wall and "depth" away from it; the panel starts Pad along.</summary>
public readonly record struct DockBox(double Left, double Top, double Width, double Height, double TabOffset, double PanelAlong, double PanelDepth);

/// <summary>The drawer's edge docking, free of any window code.</summary>
public static class DrawerDock
{
    /// <summary>Room in the window around the panel: along the wall for the liquid shoulders and the spring's overshoot, away from it for the overshoot.</summary>
    public const double Pad = 20, Overshoot = 12;

    /// <summary>The handle stays this far from the panel's ends, so it always leaves the panel's rounded corners whole.</summary>
    public const double TabInset = 16;

    static double Fit(double value, double min, double max) => Math.Max(min, Math.Min(value, max));

    public static bool IsVertical(DockEdge edge) => edge is DockEdge.Right or DockEdge.Left;

    /// <summary>The edge closest to the point. The current edge wins unless another is closer by <paramref name="stick"/>, so a corner does not flicker between two.</summary>
    public static DockEdge Nearest(DockArea area, double x, double y, DockEdge current, double stick)
    {
        double Distance(DockEdge edge) => edge switch
        {
            DockEdge.Right => Math.Abs(area.Right - x),
            DockEdge.Left => Math.Abs(x - area.Left),
            DockEdge.Top => Math.Abs(y - area.Top),
            _ => Math.Abs(area.Bottom - y),
        };
        var best = Enum.GetValues<DockEdge>().MinBy(Distance);
        return Distance(best) + stick < Distance(current) ? best : current;
    }

    /// <summary>The panel centers on the handle and stays on the screen; the handle follows the point.</summary>
    public static DockBox Box(DockEdge edge, DockArea area, double x, double y, double panelWidth, double panelHeight, double tabThick, double tabLong)
    {
        var vertical = IsVertical(edge);
        var (start, end, point) = vertical ? (area.Top, area.Bottom, y) : (area.Left, area.Right, x);
        var (wallStart, wallSize) = vertical ? (area.Left, area.Right - area.Left) : (area.Top, area.Bottom - area.Top);

        var along = Math.Min(vertical ? panelHeight : panelWidth, end - start - 2 * Pad);
        var depth = Math.Min(vertical ? panelWidth : panelHeight, wallSize - tabThick - Overshoot);
        var windowAlong = along + 2 * Pad;
        var windowDepth = depth + tabThick + Overshoot;

        var margin = Pad + TabInset + tabLong / 2;
        var center = Fit(point, start + margin, end - margin);
        var windowStart = Fit(center - windowAlong / 2, start, end - windowAlong);
        var tabOffset = center - tabLong / 2 - windowStart;
        var fromWall = edge is DockEdge.Right or DockEdge.Bottom ? wallStart + wallSize - windowDepth : wallStart;
        return vertical
            ? new DockBox(fromWall, windowStart, windowDepth, windowAlong, tabOffset, along, depth)
            : new DockBox(windowStart, fromWall, windowAlong, windowDepth, tabOffset, along, depth);
    }

    public static string Save(DockEdge edge, double x, double y) => string.Create(CultureInfo.InvariantCulture, $"{edge},{x:0},{y:0}");

    /// <summary>What <see cref="Save"/> wrote; anything else reads as nothing, and the drawer goes back to its default place.</summary>
    public static (DockEdge Edge, double X, double Y)? Parse(string? text)
    {
        var parts = text?.Split(',');
        return parts is { Length: 3 } && Enum.TryParse<DockEdge>(parts[0], out var edge) && Enum.IsDefined(edge)
            && double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var x) && double.IsFinite(x)
            && double.TryParse(parts[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var y) && double.IsFinite(y)
            ? (edge, x, y) : null;
    }
}

/// <summary>Open 0..1 (a little over while the spring overshoots). A spring opens, a timed curve closes without overshoot: the motion values of Coucou's island.</summary>
public sealed class DrawerMotion
{
    const double Omega = 2 * Math.PI / 0.5, Damping = 0.72, CloseSeconds = 0.34, MaxStep = 1 / 240.0;
    const double RestDistance = 0.001, RestSpeed = 0.01;

    double velocity, closeFrom, closeElapsed;
    bool opening, moving;

    public double Value { get; private set; }
    public bool Moving => moving;

    public void Jump(double value) => (Value, velocity, moving) = (value, 0, false);

    public void Open() => (opening, moving) = (true, true);

    public void Close()
    {
        (opening, moving, closeFrom, closeElapsed, velocity) = (false, true, Value, 0, 0);
    }

    public void Step(double seconds)
    {
        if (!moving) return;
        if (!opening)
        {
            closeElapsed += seconds;
            var t = Math.Min(closeElapsed / CloseSeconds, 1);
            Value = closeFrom * (1 - CloseCurve(t));
            if (t >= 1) Jump(0);
            return;
        }
        // sub-stepped, so a dropped frame cannot shake it
        var steps = Math.Max(1, (int)Math.Ceiling(seconds / MaxStep));
        for (var i = 0; i < steps; i++)
        {
            velocity += (Omega * Omega * (1 - Value) - 2 * Damping * Omega * velocity) * (seconds / steps);
            Value += velocity * (seconds / steps);
        }
        if (Math.Abs(1 - Value) < RestDistance && Math.Abs(velocity) < RestSpeed) Jump(1);
    }

    // cubic-bezier(.45,0,.2,1): bisection on x
    static double CloseCurve(double x)
    {
        static double Bezier(double t, double p1, double p2) => 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
        double low = 0, high = 1;
        for (var i = 0; i < 16; i++)
        {
            var middle = (low + high) / 2;
            if (Bezier(middle, 0.45, 0.2) < x) low = middle; else high = middle;
        }
        return Bezier((low + high) / 2, 0, 1);
    }
}

/// <summary>One curve of an outline; a straight stretch has its control on its end.</summary>
public readonly record struct DockCurve(double ControlAlong, double ControlDepth, double Along, double Depth);

/// <summary>
/// The drawer as one liquid shape growing out of the wall: closed it is only the handle; opening, it swells into the panel with the handle
/// pushed along on its free side. Shoulders and fillets curve in so it never meets the wall or the handle at a hard corner.
/// </summary>
public static class DrawerShape
{
    const double SpreadLag = 1.35, SwellCorner = 26, SwellShoulder = 12;

    static double Lerp(double from, double to, double t) => from + (to - from) * t;
    static double Seg(double value, double from, double to) => Math.Clamp((value - from) / (to - from), 0, 1);
    static double AtLeastZero(double value) => Math.Max(0, value);

    /// <summary>Starts on the wall at the returned start; the curves end back on the wall. <paramref name="tabStart"/> and the rest are in window units, along the wall.</summary>
    public static (double StartAlong, IReadOnlyList<DockCurve> Curves) Outline(double open, double tabStart, double tabLong, double tabThick, double panelStart, double panelAlong, double panelDepth, double windowAlong)
    {
        var grow = Math.Max(0, open);
        var settled = Math.Min(grow, 1);
        // liquid: it pushes out first and spreads after, and is roundest in the middle of the swell
        var spread = Math.Pow(grow, SpreadLag);
        var swell = Math.Sin(Math.PI * settled);
        var a = Lerp(tabStart, panelStart, spread);
        var b = Lerp(tabStart + tabLong, panelStart + panelAlong, spread);
        var depth = Lerp(tabThick, panelDepth, grow);
        var nub = tabThick * Seg(settled, 0.15, 0.6);

        var corner = Math.Min(Lerp(6, 10, settled) + SwellCorner * swell, Math.Min(depth / 2, (b - a) / 2));
        var shoulder = Lerp(6, 10, settled) + SwellShoulder * swell;
        var shoulderStart = Math.Min(shoulder, a);
        var shoulderEnd = Math.Min(shoulder, windowAlong - b);
        var shoulderDepth = Math.Min(shoulder, depth - corner);

        var c = Math.Max(tabStart, a + corner);
        var d = Math.Min(tabStart + tabLong, b - corner);
        var nubCorner = Math.Min(Math.Min(6, nub), AtLeastZero(d - c) / 2);
        var fillet = AtLeastZero(Math.Min(Math.Min(6, nub - nubCorner), Math.Min(c - a - corner, b - d - corner)));
        var top = depth + nub;

        static DockCurve Line(double along, double depth) => new(along, depth, along, depth);
        return (a - shoulderStart,
        [
            new(a, 0, a, shoulderDepth),
            Line(a, depth - corner),
            new(a, depth, a + corner, depth),
            Line(c - fillet, depth),
            new(c, depth, c, depth + fillet),
            Line(c, top - nubCorner),
            new(c, top, c + nubCorner, top),
            Line(d - nubCorner, top),
            new(d, top, d, top - nubCorner),
            Line(d, depth + fillet),
            new(d, depth, d + fillet, depth),
            Line(b - corner, depth),
            new(b, depth, b, depth - corner),
            Line(b, shoulderDepth),
            new(b, 0, b + shoulderEnd, 0),
        ]);
    }
}
